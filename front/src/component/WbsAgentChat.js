/**
 * WbsAgentChat.js
 *
 * WBS 탭 우측 하단에 떠 있는 AI 에이전트 채팅 버튼 + 패널.
 * 대화를 통해 현장 프로젝트 정보를 수집하고, 충분한 정보(projectName)가
 * 모이면 확인 카드를 보여준 뒤 사용자가 승인하면 /api/wbs/project 로 생성.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import AxiosCustom from "../axios/AxiosCustom";

// ── 수집 필드 한글 레이블 ────────────────────────────────────────
const FIELD_LABELS = {
  projectName:    "현장명",
  location:       "위치",
  startDate:      "착공일",
  endDate:        "준공일",
  contractAmount: "계약금액",
  clientName:     "발주처",
  managerName:    "현장소장",
  description:    "설명",
  status:         "상태",
};

// ── 계약금액 포맷 ───────────────────────────────────────────────
function fmtAmount(v) {
  const n = Number(String(v).replace(/[^0-9]/g, ""));
  return isNaN(n) ? v : `₩ ${n.toLocaleString()}`;
}

function fmtValue(key, val) {
  if (!val) return "—";
  if (key === "contractAmount") return fmtAmount(val);
  return val;
}

// ── 수집 정보 확인 카드 ─────────────────────────────────────────
function ConfirmCard({ collected, onConfirm, onDismiss, creating }) {
  const keys = Object.keys(collected).filter(k => collected[k]);
  return (
    <div style={{
      margin: "8px 0",
      padding: "12px",
      borderRadius: 12,
      background: "linear-gradient(135deg, #0f2d1a, #0a1521)",
      border: "1px solid #22c55e60",
    }}>
      <p style={{ fontSize: 12, color: "#4ade80", fontWeight: 700, marginBottom: 8 }}>
        ✅ 다음 정보로 현장 프로젝트를 생성합니다
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", marginBottom: 10 }}>
        {keys.map(k => (
          <div key={k} style={{ fontSize: 11 }}>
            <span style={{ color: "#64748b" }}>{FIELD_LABELS[k] || k}: </span>
            <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{fmtValue(k, collected[k])}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onDismiss}
          style={{
            flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 12,
            background: "#1c2a3a", border: "1px solid #253347", color: "#94a3b8",
            cursor: "pointer",
          }}>
          취소
        </button>
        <button
          onClick={onConfirm}
          disabled={creating}
          style={{
            flex: 2, padding: "6px 0", borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: creating ? "#14532d" : "linear-gradient(135deg,#15803d,#166534)",
            border: "1px solid #22c55e",
            color: creating ? "#4ade8080" : "#4ade80",
            cursor: creating ? "not-allowed" : "pointer",
          }}>
          {creating ? "생성 중…" : "🏗 현장 생성"}
        </button>
      </div>
    </div>
  );
}

// ── 메시지 버블 ─────────────────────────────────────────────────
function Bubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 8,
    }}>
      {!isUser && (
        <div style={{
          width: 26, height: 26, borderRadius: "50%",
          background: "linear-gradient(135deg,#1d4ed8,#7c3aed)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, marginRight: 6, flexShrink: 0, marginTop: 2,
        }}>🤖</div>
      )}
      <div style={{
        maxWidth: "78%",
        padding: "8px 11px",
        borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        background: isUser
          ? "linear-gradient(135deg,#1d4ed8,#1e40af)"
          : "#1c2a3a",
        border: `1px solid ${isUser ? "#3b82f640" : "#253347"}`,
        fontSize: 12,
        lineHeight: 1.55,
        color: isUser ? "#dbeafe" : "#cbd5e1",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>
        {msg.content}
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ───────────────────────────────────────────────
export default function WbsAgentChat({ onProjectCreated }) {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState([]);   // {role, content}
  const [collected, setCollected] = useState({});
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [doneMsg, setDoneMsg]   = useState("");

  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const panelRef   = useRef(null);

  // 패널 열 때 포커스
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80);
      if (messages.length === 0) {
        // 초기 환영 메시지
        setMessages([{
          role: "assistant",
          content: "안녕하세요! 🏗\n새 현장 프로젝트를 만들어 드릴게요.\n현장명(프로젝트명)을 알려주시면 바로 시작할 수 있습니다.",
        }]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 스크롤 하단 유지
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showConfirm, doneMsg]);

  // 패널 닫기 → 세션 초기화
  const handleClose = useCallback(() => {
    setOpen(false);
    setMessages([]);
    setCollected({});
    setInput("");
    setShowConfirm(false);
    setDoneMsg("");
  }, []);

  // 메시지 전송
  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return;
    const userMsg = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setShowConfirm(false);

    // history 형식 (시스템 메시지 제외)
    const history = messages.map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await AxiosCustom.post("/api/chat/wbs-project-chat", {
        message: text.trim(),
        history,
        collected,
      });
      const data = res.data;
      const newCollected = { ...collected, ...(data.collected || {}) };
      setCollected(newCollected);

      const assistantMsg = { role: "assistant", content: data.response };
      setMessages(prev => [...prev, assistantMsg]);

      // projectName 이 수집되면 확인 카드 표시
      if (data.ready && newCollected.projectName) {
        setTimeout(() => setShowConfirm(true), 300);
      }
    } catch (err) {
      console.error("[WbsAgentChat] API 오류:", err);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "죄송합니다, 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [messages, collected, loading]);

  // 엔터 키 처리
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // 프로젝트 생성 확인
  const handleConfirm = useCallback(async () => {
    setCreating(true);
    try {
      await AxiosCustom.post("/api/wbs/project", {
        projectName:    collected.projectName    || "",
        location:       collected.location       || "",
        startDate:      collected.startDate      || null,
        endDate:        collected.endDate        || null,
        contractAmount: collected.contractAmount ? Number(String(collected.contractAmount).replace(/[^0-9]/g, "")) : null,
        clientName:     collected.clientName     || "",
        managerName:    collected.managerName    || "",
        description:    collected.description    || "",
        status:         collected.status         || "PLANNED",
      });
      setShowConfirm(false);
      setDoneMsg(`✅ "${collected.projectName}" 현장이 생성되었습니다!`);
      if (onProjectCreated) onProjectCreated();
      // 3초 후 패널 닫기
      setTimeout(() => handleClose(), 3000);
    } catch (err) {
      console.error("[WbsAgentChat] 프로젝트 생성 실패:", err);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "현장 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      }]);
      setShowConfirm(false);
    } finally {
      setCreating(false);
    }
  }, [collected, onProjectCreated, handleClose]);

  // ── 렌더 ──────────────────────────────────────────────────────
  return (
    <>
      {/* ── 채팅 패널 ── */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            bottom: 76,
            right: 20,
            width: 340,
            maxHeight: "60vh",
            display: "flex",
            flexDirection: "column",
            borderRadius: 16,
            background: "#0a1521",
            border: "1px solid #1e3a5f",
            boxShadow: "0 8px 40px #00000080",
            zIndex: 9000,
            overflow: "hidden",
          }}
        >
          {/* 헤더 */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 14px",
            background: "linear-gradient(135deg, #0f172a, #0a1521)",
            borderBottom: "1px solid #1e3a5f",
            flexShrink: 0,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: "linear-gradient(135deg,#1d4ed8,#7c3aed)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 15,
            }}>🤖</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>WBS 현장 등록 도우미</div>
              <div style={{ fontSize: 10, color: "#475569" }}>대화로 현장 프로젝트를 만들어요</div>
            </div>
            {/* 수집 상태 표시 */}
            {collected.projectName && (
              <span style={{
                fontSize: 10, padding: "2px 7px", borderRadius: 20,
                background: "#14532d", color: "#4ade80", border: "1px solid #16a34a40",
              }}>
                ✓ {Object.keys(collected).length}개 수집
              </span>
            )}
            <button
              onClick={handleClose}
              style={{
                background: "none", border: "none", color: "#475569",
                cursor: "pointer", fontSize: 16, padding: "0 2px",
                lineHeight: 1,
              }}>✕</button>
          </div>

          {/* 메시지 영역 */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 12px 4px",
            minHeight: 0,
          }}>
            {messages.map((msg, i) => (
              <Bubble key={i} msg={msg} />
            ))}

            {/* 로딩 인디케이터 */}
            {loading && (
              <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: "50%",
                  background: "linear-gradient(135deg,#1d4ed8,#7c3aed)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, marginRight: 6, flexShrink: 0,
                }}>🤖</div>
                <div style={{
                  padding: "8px 12px", borderRadius: "14px 14px 14px 4px",
                  background: "#1c2a3a", border: "1px solid #253347",
                  display: "flex", gap: 4, alignItems: "center",
                }}>
                  {[0, 1, 2].map(i => (
                    <span key={i} style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: "#3b82f6",
                      animation: `wbs-bounce 1s ease-in-out ${i * 0.15}s infinite`,
                      display: "inline-block",
                    }} />
                  ))}
                </div>
              </div>
            )}

            {/* 확인 카드 */}
            {showConfirm && !loading && (
              <ConfirmCard
                collected={collected}
                onConfirm={handleConfirm}
                onDismiss={() => setShowConfirm(false)}
                creating={creating}
              />
            )}

            {/* 완료 메시지 */}
            {doneMsg && (
              <div style={{
                padding: "10px 12px", borderRadius: 10, marginBottom: 8,
                background: "#14532d", border: "1px solid #22c55e40",
                fontSize: 12, color: "#4ade80", fontWeight: 600, textAlign: "center",
              }}>
                {doneMsg}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* 입력창 */}
          <div style={{
            display: "flex", gap: 6, padding: "8px 10px",
            borderTop: "1px solid #1e3a5f", flexShrink: 0,
            background: "#06111c",
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="현장명, 위치, 발주처 등을 말씀해 주세요…"
              rows={1}
              disabled={loading || !!doneMsg}
              style={{
                flex: 1,
                background: "#0d1b2a",
                border: "1px solid #253347",
                borderRadius: 10,
                color: "#e2e8f0",
                fontSize: 12,
                padding: "7px 10px",
                resize: "none",
                outline: "none",
                lineHeight: 1.4,
                minHeight: 34,
                maxHeight: 80,
                overflowY: "auto",
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading || !!doneMsg}
              style={{
                width: 34, height: 34,
                borderRadius: 10, border: "none",
                background: (!input.trim() || loading || !!doneMsg)
                  ? "#1c2a3a" : "linear-gradient(135deg,#1d4ed8,#1e40af)",
                color: (!input.trim() || loading || !!doneMsg) ? "#334155" : "#93c5fd",
                cursor: (!input.trim() || loading || !!doneMsg) ? "not-allowed" : "pointer",
                fontSize: 15, flexShrink: 0, alignSelf: "flex-end",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
              ➤
            </button>
          </div>
        </div>
      )}

      {/* ── 플로팅 버튼 ── */}
      <button
        onClick={() => setOpen(v => !v)}
        title="AI 현장 등록 도우미"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: open
            ? "linear-gradient(135deg,#0f2d1a,#0a1521)"
            : "linear-gradient(135deg,#1d4ed8,#7c3aed)",
          border: `2px solid ${open ? "#22c55e" : "#4f46e5"}`,
          boxShadow: open
            ? "0 0 0 3px #22c55e30, 0 4px 20px #00000060"
            : "0 0 0 3px #4f46e530, 0 4px 20px #00000060",
          cursor: "pointer",
          zIndex: 9001,
          fontSize: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.2s ease",
        }}>
        {open ? "✕" : "🤖"}
      </button>

      {/* 도트 애니메이션 스타일 */}
      <style>{`
        @keyframes wbs-bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </>
  );
}
