/**
 * FloatingAgent.js
 *
 * WbsAgentChat 디자인을 기반으로 한 전체 탭 공용 AI 에이전트 패널.
 * viewComponent prop으로 현재 탭을 판별해 탭별 컨텍스트(환영 메시지·빠른 질문·색상)를 제공한다.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import AxiosCustom from "../axios/AxiosCustom";

const API_BASE = `/api/chat`;

// ── 탭별 설정 ─────────────────────────────────────────────────────
const TAB_CONFIGS = {
  bim: {
    title: "BIM Agent",
    subtitle: "부재 생성·조회·삭제 · IFC 분석",
    icon: "🏗",
    btnGradient: "linear-gradient(135deg,#1d4ed8,#7c3aed)",
    btnBorder: "#4f46e5",
    welcome:
      "안녕하세요! 🏗 BIM Agent입니다.\n부재 생성/삭제/조회, IFC 분석, 드론 사진 변환, 구조 해석을 도와드립니다.\n현재 프로젝트 기준으로 작업합니다.",
    quickPrompts: ["프로젝트 목록 보여줘", "기둥 추가해줘", "부재 통계 알려줘"],
    agentName: "bim_agent",
  },
  "bim-projects": {
    title: "BIM Agent",
    subtitle: "BIM 프로젝트 관리 · IFC 업로드",
    icon: "📁",
    btnGradient: "linear-gradient(135deg,#1d4ed8,#7c3aed)",
    btnBorder: "#4f46e5",
    welcome:
      "안녕하세요! 📁 BIM Agent입니다.\n프로젝트 생성, IFC 파일 업로드, 드론 데이터 변환을 도와드립니다.",
    quickPrompts: ["BIM 프로젝트 목록", "새 프로젝트 만들어줘", "IFC 파일 업로드 방법"],
    agentName: "bim_agent",
  },
  simulation: {
    title: "시뮬레이션 Agent",
    subtitle: "굴착기 각도 제어 · 자세 프리셋",
    icon: "🦾",
    btnGradient: "linear-gradient(135deg,#059669,#0891b2)",
    btnBorder: "#10b981",
    welcome:
      "안녕하세요! 🦾 시뮬레이션 Agent입니다.\n굴착기 붐·암·버킷 각도 제어, 자세 프리셋 전환, 상태 조회를 도와드립니다.",
    quickPrompts: ["굴착기 상태 확인", "DIG 자세로 변경", "붐 각도 45도로 설정"],
    agentName: "simulation_agent",
  },
  "simulation-projects": {
    title: "시뮬레이션 Agent",
    subtitle: "시뮬레이션 프로젝트 관리",
    icon: "🦾",
    btnGradient: "linear-gradient(135deg,#059669,#0891b2)",
    btnBorder: "#10b981",
    welcome:
      "안녕하세요! 🦾 시뮬레이션 Agent입니다.\n굴착기 시뮬레이션 제어, 자세 변경, 각도 설정을 도와드립니다.",
    quickPrompts: ["굴착기 상태 확인", "IDLE 자세로 초기화", "선회 각도 설정"],
    agentName: "simulation_agent",
  },
  safe: {
    title: "안전 Agent",
    subtitle: "헬멧 감지 · 침입 감지 · YOLO",
    icon: "⛑️",
    btnGradient: "linear-gradient(135deg,#dc2626,#9f1239)",
    btnBorder: "#ef4444",
    welcome:
      "안녕하세요! ⛑️ 안전 Agent입니다.\n헬멧 미착용 감지, 침입 이벤트, 안전 통계를 도와드립니다.",
    quickPrompts: ["최근 헬멧 위반 현황", "침입 감지 이벤트 조회", "안전 통계 보여줘"],
    agentName: "safe_agent",
  },
  "safe-projects": {
    title: "안전 Agent",
    subtitle: "안전 프로젝트 · 카메라 관리",
    icon: "⛑️",
    btnGradient: "linear-gradient(135deg,#dc2626,#9f1239)",
    btnBorder: "#ef4444",
    welcome:
      "안녕하세요! ⛑️ 안전 Agent입니다.\n안전 모니터링 기능, 카메라 설정, 감지 이벤트를 안내해드립니다.",
    quickPrompts: ["안전 모니터링 사용법", "감지 서버 상태 확인", "안전 이벤트 통계"],
    agentName: "safe_agent",
  },
  test: {
    title: "충돌 테스트 Agent",
    subtitle: "3D 충돌 감지 · 키보드 조작",
    icon: "⚠️",
    btnGradient: "linear-gradient(135deg,#b45309,#92400e)",
    btnBorder: "#f59e0b",
    welcome:
      "안녕하세요! ⚠️ 충돌 테스트 Agent입니다.\n키보드 조작법, 충돌 로그 조회, 충돌 해결 방법을 안내해드립니다.",
    quickPrompts: ["키보드 조작법 알려줘", "충돌 로그 확인", "충돌 해결 방법"],
    agentName: "test_agent",
  },
};

const DEFAULT_CONFIG = {
  title: "AI 현장 도우미",
  subtitle: "건설 현장 AI 분석",
  icon: "🤖",
  btnGradient: "linear-gradient(135deg,#1d4ed8,#7c3aed)",
  btnBorder: "#4f46e5",
  welcome:
    "안녕하세요! 🤖\n건설 현장 관련 무엇이든 질문해주세요.\n프로젝트 분석, 일정 관리, 현장 지원을 도와드립니다.",
  quickPrompts: ["현장 현황 분석", "일정 조회", "안전 점검 항목"],
  agentName: null,
};

// ── 메시지 버블 ─────────────────────────────────────────────────
function Bubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 8 }}>
      {!isUser && (
        <div style={{
          width: 26, height: 26, borderRadius: "50%",
          background: "linear-gradient(135deg,#1d4ed8,#7c3aed)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, marginRight: 6, flexShrink: 0, marginTop: 2,
        }}>🤖</div>
      )}
      <div style={{
        maxWidth: "78%", padding: "8px 11px",
        borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        background: isUser ? "linear-gradient(135deg,#1d4ed8,#1e40af)" : "#1c2a3a",
        border: `1px solid ${isUser ? "#3b82f640" : "#253347"}`,
        fontSize: 12, lineHeight: 1.55,
        color: isUser ? "#dbeafe" : "#cbd5e1",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        {msg.content}
      </div>
    </div>
  );
}

// ── 로딩 인디케이터 ─────────────────────────────────────────────
function LoadingBubble() {
  return (
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
            width: 6, height: 6, borderRadius: "50%", background: "#3b82f6",
            animation: `agent-dot 1s ease-in-out ${i * 0.15}s infinite`,
            display: "inline-block",
          }} />
        ))}
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ───────────────────────────────────────────────
export default function FloatingAgent({ viewComponent, selectedProject, selectedSimulationProject }) {
  const config = TAB_CONFIGS[viewComponent] || DEFAULT_CONFIG;
  const contextProject = selectedProject || selectedSimulationProject;

  const [open, setOpen]       = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const [hasStt, setHasStt]   = useState(false);
  const [isListening, setIsListening] = useState(false);

  const [sessionId] = useState(() => `agent-${Date.now()}`);

  const bottomRef    = useRef(null);
  const inputRef     = useRef(null);
  const recognitionRef = useRef(null);
  // configRef: 비동기 콜백에서 항상 최신 config를 참조
  const configRef    = useRef(config);
  useEffect(() => { configRef.current = config; });
  // messagesRef: sendMessage 클로저 내에서 최신 메시지 참조
  const messagesRef  = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // ── STT 초기화 ────────────────────────────────────────────────
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "ko-KR";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => { setInput(e.results[0][0].transcript); setIsListening(false); };
    rec.onend  = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    recognitionRef.current = rec;
    setHasStt(true);
  }, []);

  // ── 탭 전환 시 채팅 초기화 ────────────────────────────────────
  useEffect(() => {
    setMessages([]);
    setInput("");
  }, [viewComponent]);

  // ── 패널 열 때 환영 메시지 + 포커스 ──────────────────────────
  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 80);
    setMessages(prev =>
      prev.length === 0
        ? [{ role: "assistant", content: configRef.current.welcome }]
        : prev
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── 스크롤 하단 유지 ──────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── 음성 입력 토글 ────────────────────────────────────────────
  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) return;
    if (isListening) { recognitionRef.current.stop(); }
    else { recognitionRef.current.start(); setIsListening(true); }
  }, [isListening]);

  // ── 메시지 전송 ───────────────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    const trimmed = text?.trim();
    if (!trimmed || loading) return;

    setMessages(prev => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    setLoading(true);

    const history = messagesRef.current.map(m => ({ role: m.role, content: m.content }));
    const agentName = configRef.current.agentName || null;

    try {
      const res = await AxiosCustom.post(`${API_BASE}/message`, {
        sessionId,
        message: trimmed,
        history,
        directAgent:         agentName,
        projectId:           selectedProject?.projectId   || null,
        simulationProjectId: selectedSimulationProject?.projectId || null,
        wbsProjectId:        null,
      });
      setMessages(prev => [...prev, { role: "assistant", content: res.data.response || "응답을 받지 못했습니다." }]);
    } catch {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "죄송합니다, 오류가 발생했습니다. Agent 서버가 실행 중인지 확인해 주세요.",
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [loading, sessionId, selectedProject, selectedSimulationProject]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  // ── 렌더 ──────────────────────────────────────────────────────
  return (
    <>
      {/* ── 채팅 패널 ── */}
      {open && (
        <div style={{
          position: "fixed", bottom: 76, right: 20, width: 340,
          maxHeight: "60vh", display: "flex", flexDirection: "column",
          borderRadius: 16, background: "#0a1521",
          border: "1px solid #1e3a5f", boxShadow: "0 8px 40px #00000080",
          zIndex: 9000, overflow: "hidden",
        }}>
          {/* 헤더 */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
            background: "linear-gradient(135deg, #0f172a, #0a1521)",
            borderBottom: "1px solid #1e3a5f", flexShrink: 0,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: config.btnGradient,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
            }}>{config.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{config.title}</div>
              <div style={{ fontSize: 10, color: "#475569" }}>{config.subtitle}</div>
            </div>
            {contextProject && (
              <span style={{
                fontSize: 10, padding: "2px 7px", borderRadius: 20, flexShrink: 0,
                background: "#1e3a5f", color: "#60a5fa", border: "1px solid #3b82f640",
                maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>📋 {contextProject.projectName}</span>
            )}
            <button
              onClick={() => setOpen(false)}
              style={{
                background: "none", border: "none", color: "#475569",
                cursor: "pointer", fontSize: 16, padding: "0 2px",
                lineHeight: 1, flexShrink: 0,
              }}>✕</button>
          </div>

          {/* 빠른 질문 칩 */}
          <div style={{
            display: "flex", gap: 5, padding: "8px 10px 4px",
            overflowX: "auto", flexShrink: 0, scrollbarWidth: "none",
          }}>
            {config.quickPrompts.map((p, i) => (
              <button
                key={i}
                onClick={() => sendMessage(p)}
                disabled={loading}
                style={{
                  padding: "4px 10px", borderRadius: 20, whiteSpace: "nowrap",
                  background: "#1c2a3a", border: "1px solid #253347",
                  color: "#94a3b8", fontSize: 10,
                  cursor: loading ? "not-allowed" : "pointer", flexShrink: 0,
                }}>{p}</button>
            ))}
          </div>

          {/* 메시지 영역 */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px 4px", minHeight: 0 }}>
            {messages.map((msg, i) => <Bubble key={i} msg={msg} />)}
            {loading && <LoadingBubble />}
            <div ref={bottomRef} />
          </div>

          {/* 입력창 */}
          <div style={{
            display: "flex", gap: 6, padding: "8px 10px",
            borderTop: "1px solid #1e3a5f", flexShrink: 0,
            background: "#06111c", alignItems: "flex-end",
          }}>
            {hasStt && (
              <button
                onClick={toggleListening}
                title={isListening ? "녹음 중지" : "음성 입력"}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 16, padding: "4px 2px", flexShrink: 0,
                  color: isListening ? "#ef4444" : "#475569",
                }}>🎤</button>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isListening ? "듣는 중…" : `${config.title}에게 질문하세요…`}
              rows={1}
              disabled={loading}
              style={{
                flex: 1, background: "#0d1b2a",
                border: "1px solid #253347", borderRadius: 10,
                color: "#e2e8f0", fontSize: 12, padding: "7px 10px",
                resize: "none", outline: "none", lineHeight: 1.4,
                minHeight: 34, maxHeight: 80, overflowY: "auto",
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              style={{
                width: 34, height: 34, borderRadius: 10, border: "none", flexShrink: 0,
                background: !input.trim() || loading ? "#1c2a3a" : config.btnGradient,
                color: !input.trim() || loading ? "#334155" : "#93c5fd",
                cursor: !input.trim() || loading ? "not-allowed" : "pointer",
                fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center",
              }}>➤</button>
          </div>
        </div>
      )}

      {/* ── 플로팅 버튼 ── */}
      <button
        onClick={() => setOpen(v => !v)}
        title={config.title}
        style={{
          position: "fixed", bottom: 20, right: 20,
          width: 48, height: 48, borderRadius: "50%",
          zIndex: 9001, fontSize: 20,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", transition: "all 0.2s ease",
          background: open
            ? "linear-gradient(135deg,#0f2d1a,#0a1521)"
            : config.btnGradient,
          border: `2px solid ${open ? "#22c55e" : config.btnBorder}`,
          boxShadow: open
            ? "0 0 0 3px #22c55e30, 0 4px 20px #00000060"
            : "0 0 0 3px rgba(79,70,229,0.18), 0 4px 20px #00000060",
        }}>
        {open ? "✕" : config.icon}
      </button>

      <style>{`
        @keyframes agent-dot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40%            { transform: scale(1);   opacity: 1;   }
        }
      `}</style>
    </>
  );
}
