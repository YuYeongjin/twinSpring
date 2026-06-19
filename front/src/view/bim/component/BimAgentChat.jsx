/**
 * BimAgentChat.jsx
 *
 * BIM 에디터 내 AI 에이전트 채팅 패널.
 * directAgent="bim_wbs_agent" 로 라우팅되어 두 가지 작업을 처리합니다.
 *   1. 구조 안정성 검토 → 구조해석 탭 자동 전환
 *   2. WBS 스케줄링    → 기존 WBS 업데이트 or 신규 공정표 생성
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import AxiosCustom from "../../../axios/AxiosCustom";
import { useT } from "../../../i18n/LanguageContext";

const SESSION_ID = "bim-wbs-agent-" + Math.random().toString(36).slice(2, 8);

// ── 버블 컴포넌트 ─────────────────────────────────────────────────────────────
function Bubble({ msg }) {
  const isUser = msg.role === "user";
  const isAction = msg.role === "action";

  if (isAction) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
        <div style={{
          padding: "8px 12px",
          borderRadius: "12px",
          background: msg.success
            ? "linear-gradient(135deg,#14532d,#166534)"
            : "linear-gradient(135deg,#7f1d1d,#991b1b)",
          border: `1px solid ${msg.success ? "#22c55e40" : "#ef444440"}`,
          fontSize: 12,
          color: msg.success ? "#bbf7d0" : "#fca5a5",
          maxWidth: "85%",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          lineHeight: 1.6,
        }}>
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 8,
    }}>
      {!isUser && (
        <div style={{
          width: 26, height: 26, borderRadius: "50%",
          background: "linear-gradient(135deg,#1d4ed8,#1e3a8a)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, marginRight: 6, flexShrink: 0, marginTop: 2,
        }}>🏗</div>
      )}
      <div style={{
        maxWidth: "80%",
        padding: "8px 11px",
        borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        background: isUser
          ? "linear-gradient(135deg,#1d4ed8,#1e40af)"
          : "#1c2a3a",
        border: `1px solid ${isUser ? "#3b82f640" : "#253347"}`,
        fontSize: 12,
        lineHeight: 1.6,
        color: isUser ? "#dbeafe" : "#cbd5e1",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>
        {msg.content}
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function BimAgentChat({
  selectedProject,
  selectedElementIds, // string[] — 현재 선택된 부재 ID 목록
  onShowStructural,   // () => void — 구조해석 탭 전환 콜백
  onWbsChanged,       // () => void — WBS 변경 후 콜백 (선택)
  onGlbReload,        // () => void — GLB 캐시버스트 후 뷰어 리로드 콜백
}) {
  const t = useT('bimDashboard');
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  const projectName = selectedProject?.projectName || t('agentThisProject');

  const QUICK_ACTIONS = useMemo(() => [
    { label: t('agentQuickStructural'), icon: "🔬", message: "이 프로젝트의 구조 안정성을 검토해줘" },
    { label: t('agentQuickWbsSchedule'), icon: "📋", message: "이 프로젝트의 WBS 스케줄링을 넣어줘" },
    { label: t('agentQuickWbsNew'),   icon: "➕", message: "이 프로젝트의 WBS를 신규로 만들어줘" },
  ], [t]);

  const getWelcome = useCallback(() =>
    t('agentWelcome', { name: projectName }),
  [projectName, t]);

  // 패널 열릴 때 초기화
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80);
      if (messages.length === 0) {
        setMessages([{ role: "assistant", content: getWelcome() }]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 프로젝트 변경 시 환영 메시지 갱신
  useEffect(() => {
    if (messages.length === 1 && messages[0].role === "assistant") {
      setMessages([{ role: "assistant", content: getWelcome() }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.projectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setMessages([]);
    setInput("");
  }, []);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return;

    const newMessages = [...messages, { role: "user", content: text.trim() }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    const history = messages.map(m =>
      m.role === "action" ? null : { role: m.role, content: m.content }
    ).filter(Boolean);

    try {
      const res = await AxiosCustom.post("/api/chat/message", {
        sessionId:           SESSION_ID,
        message:             text.trim(),
        history,
        uiLang:              "ko",
        directAgent:         "bim_wbs_agent",
        projectId:           selectedProject?.projectId
                               ? String(selectedProject.projectId)
                               : null,
        simulationProjectId: null,
        wbsProjectId:        null,
        selectedElementIds:  selectedElementIds?.length > 0 ? selectedElementIds : null,
      });

      const data = res.data;
      const reply = data.response || t('agentNoResponse');

      setMessages(prev => [...prev, { role: "assistant", content: reply }]);

      // bimData 를 통해 특수 액션 처리
      const bimData = data.bimData || {};
      const action  = bimData.action || data.intent;

      if (action === "structural_analysis") {
        onShowStructural?.();
        setMessages(prev => [...prev, {
          role:    "action",
          success: true,
          content: t('agentStructResult', { total: bimData.total ?? '?', status: bimData.status ?? '' })
                 + (bimData.warnings?.length ? t('agentStructWarn', { warnings: bimData.warnings.join(' / ') }) : ''),
        }]);
      } else if (action === "wbs_created") {
        const dur = bimData.durationDays ? t('agentWbsDur', { n: bimData.durationDays }) : '';
        setMessages(prev => [...prev, {
          role:    "action",
          success: true,
          content: t('agentWbsCreated', {
                     name: bimData.projectName ?? '',
                     floors: bimData.floorCount ?? '?',
                     tasks: bimData.taskCount ?? 0,
                     start: bimData.startDate ?? '',
                     end: bimData.endDate ?? '',
                     dur,
                   })
                 + (bimData.peakWorkers ? t('agentWbsCreatedPeak', { peak: bimData.peakWorkers }) : ''),
        }]);
        onWbsChanged?.();
      } else if (action === "wbs_updated") {
        const addedN   = bimData.totalAdded ?? bimData.added?.length ?? 0;
        const skippedN = bimData.skipped?.length ?? 0;
        setMessages(prev => [...prev, {
          role:    "action",
          success: true,
          content: t('agentWbsUpdated', {
                     name: bimData.projectName ?? '',
                     floors: bimData.floorCount ?? '?',
                     added: addedN,
                     skipped: skippedN,
                   })
                 + (bimData.peakWorkers ? t('agentWbsCreatedPeak', { peak: bimData.peakWorkers }) : ''),
        }]);
        onWbsChanged?.();
      } else if (action === "glb_reload") {
        onGlbReload?.();
        setMessages(prev => [...prev, {
          role:    "action",
          success: true,
          content: `✅ ${bimData.message ?? '부재 이동 완료'} — 3D 뷰어가 업데이트됩니다.`,
        }]);
      } else if (action === "error") {
        setMessages(prev => [...prev, {
          role:    "action",
          success: false,
          content: t('agentActionError', { error: bimData.error ?? '' }),
        }]);
      }
    } catch (err) {
      console.error("[BimAgentChat] error:", err);
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: t('agentServerError') },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [messages, loading, selectedProject, onShowStructural, onWbsChanged, onGlbReload, t]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // ── 렌더 ────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* 플로팅 버튼 */}
      <button
        onClick={() => setOpen(v => !v)}
        title="BIM Agent"
        style={{
          position:     "fixed",
          bottom:       24,
          right:        20,
          width:        46,
          height:       46,
          borderRadius: "50%",
          background:   open
            ? "linear-gradient(135deg,#1d4ed8,#1e40af)"
            : "linear-gradient(135deg,#1e3a8a,#1e40af)",
          border:       `2px solid ${open ? "#3b82f6" : "#1d4ed880"}`,
          boxShadow:    "0 4px 20px #00000060",
          cursor:       "pointer",
          display:      "flex",
          alignItems:   "center",
          justifyContent: "center",
          fontSize:     20,
          zIndex:       8000,
          transition:   "all 0.2s",
        }}
      >
        {open ? "✕" : "🏗"}
      </button>

      {/* 채팅 패널 */}
      {open && (
        <div style={{
          position:     "fixed",
          bottom:       78,
          right:        20,
          width:        360,
          maxHeight:    "62vh",
          display:      "flex",
          flexDirection:"column",
          borderRadius: 16,
          background:   "#0a1521",
          border:       "1px solid #1d4ed880",
          boxShadow:    "0 8px 40px #00000090",
          zIndex:       8001,
          overflow:     "hidden",
        }}>

          {/* 헤더 */}
          <div style={{
            display:        "flex",
            alignItems:     "center",
            gap:            8,
            padding:        "10px 14px",
            background:     "linear-gradient(135deg,#0f1e35,#0a1521)",
            borderBottom:   "1px solid #1d4ed840",
            flexShrink:     0,
          }}>
            <div style={{
              width:          28, height: 28, borderRadius: "50%",
              background:     "linear-gradient(135deg,#1d4ed8,#1e3a8a)",
              display:        "flex", alignItems: "center", justifyContent: "center",
              fontSize:       14, flexShrink: 0,
            }}>🏗</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#93c5fd" }}>
                BIM Agent
              </p>
              <p style={{ margin: 0, fontSize: 10, color: "#475569" }}>
                {projectName}
              </p>
            </div>
            <button
              onClick={handleClose}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#475569", fontSize: 16, padding: "2px 4px",
              }}
            >✕</button>
          </div>

          {/* 메시지 영역 */}
          <div style={{
            flex:       1,
            overflowY:  "auto",
            padding:    "12px 14px",
            scrollbarWidth: "thin",
            scrollbarColor: "#253347 transparent",
          }}>
            {messages.map((msg, i) => (
              <Bubble key={i} msg={msg} />
            ))}

            {loading && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: "50%",
                  background: "linear-gradient(135deg,#1d4ed8,#1e3a8a)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, flexShrink: 0,
                }}>🏗</div>
                <div style={{
                  padding: "8px 12px",
                  borderRadius: "14px 14px 14px 4px",
                  background: "#1c2a3a",
                  border: "1px solid #253347",
                  fontSize: 12,
                }}>
                  <span style={{ color: "#60a5fa", animation: "pulse 1s infinite" }}>
                    {t('agentAnalyzing')}
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* 퀵 액션 */}
          <div style={{
            padding:       "6px 10px",
            borderTop:     "1px solid #1a2a3a",
            display:       "flex",
            gap:           4,
            flexWrap:      "wrap",
            flexShrink:    0,
          }}>
            {QUICK_ACTIONS.map(({ label, icon, message }) => (
              <button
                key={label}
                onClick={() => sendMessage(message)}
                disabled={loading}
                style={{
                  padding:      "4px 8px",
                  borderRadius: 8,
                  border:       "1px solid #253347",
                  background:   "#1c2a3a",
                  color:        "#94a3b8",
                  fontSize:     11,
                  cursor:       loading ? "default" : "pointer",
                  opacity:      loading ? 0.5 : 1,
                  transition:   "all 0.15s",
                  whiteSpace:   "nowrap",
                }}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          {/* 입력창 */}
          <div style={{
            display:      "flex",
            alignItems:   "center",
            gap:          8,
            padding:      "8px 10px",
            borderTop:    "1px solid #1a2a3a",
            flexShrink:   0,
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('agentInputPh')}
              disabled={loading}
              rows={1}
              style={{
                flex:        1,
                resize:      "none",
                background:  "#0d1b2a",
                border:      "1px solid #253347",
                borderRadius: 10,
                padding:     "7px 10px",
                fontSize:    12,
                color:       "#e2e8f0",
                outline:     "none",
                scrollbarWidth: "none",
                overflowY:   "hidden",
                lineHeight:  1.5,
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              style={{
                width:        32,
                height:       32,
                borderRadius: "50%",
                border:       "none",
                background:   loading || !input.trim()
                  ? "#253347"
                  : "linear-gradient(135deg,#1d4ed8,#1e40af)",
                cursor:       loading || !input.trim() ? "default" : "pointer",
                display:      "flex",
                alignItems:   "center",
                justifyContent: "center",
                flexShrink:   0,
                fontSize:     14,
                transition:   "all 0.15s",
              }}
            >
              <span style={{ color: loading || !input.trim() ? "#475569" : "#fff" }}>
                ▶
              </span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
