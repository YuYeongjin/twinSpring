/**
 * WbsAgentChat.js
 *
 * WBS 탭 우측 하단 AI 에이전트 채팅 패널.
 * 전체 LangGraph 라우팅을 사용하여 프로젝트/태스크 CRUD,
 * BIM·Safe·Simulation 연결 등 모든 WBS 작업을 대화로 처리합니다.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import AxiosCustom from "../axios/AxiosCustom";
import { useT, useLanguage } from "../i18n/LanguageContext";

const SESSION_ID = "wbs-agent-" + Math.random().toString(36).slice(2, 8);

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
          background: "linear-gradient(135deg,#15803d,#166534)",
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

export default function WbsAgentChat({ selectedProject, onDataChanged }) {
  const t = useT("wbsAgent");
  const { lang } = useLanguage();

  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  const getWelcome = useCallback(() =>
    selectedProject
      ? t("welcomeWithProject", { projectName: selectedProject.projectName })
      : t("welcomeWithoutProject"),
  [selectedProject, t]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80);
      if (messages.length === 0) {
        setMessages([{ role: "assistant", content: getWelcome() }]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 언어 변경 시 환영 메시지 업데이트
  useEffect(() => {
    setMessages(prev =>
      prev.length === 1 && prev[0].role === "assistant"
        ? [{ role: "assistant", content: getWelcome() }]
        : prev
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // 프로젝트 변경 시 환영 메시지 업데이트 (패널이 비어 있을 때만)
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

    const history = messages.map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await AxiosCustom.post("/api/chat/message", {
        sessionId:           SESSION_ID,
        message:             text.trim(),
        history,
        uiLang:              lang,
        directAgent:         "wbs_agent",
        wbsProjectId:        selectedProject?.projectId || null,
        projectId:           null,
        simulationProjectId: null,
      });

      const data = res.data;
      setMessages(prev => [...prev, { role: "assistant", content: data.response || t("noResponse") }]);

      if (data.intent === "wbs_agent" && onDataChanged) {
        onDataChanged();
      }
    } catch (err) {
      console.error("[WbsAgentChat] 오류:", err);
      setMessages(prev => [...prev, { role: "assistant", content: t("serverError") }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [messages, loading, selectedProject, onDataChanged, t]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const quickActions = selectedProject
    ? [t("quick1WithProject"), t("quick2WithProject"), t("quick3WithProject")]
    : [t("quick1WithoutProject"), t("quick2WithoutProject")];

  return (
    <>
      {open && (
        <div style={{
          position: "fixed",
          bottom: 76,
          right: 20,
          width: 350,
          maxHeight: "65vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 16,
          background: "#0a1521",
          border: "1px solid #166534",
          boxShadow: "0 8px 40px #00000080",
          zIndex: 9000,
          overflow: "hidden",
        }}>
          {/* 헤더 */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 14px",
            background: "linear-gradient(135deg,#0f2d1a,#0a1521)",
            borderBottom: "1px solid #166534",
            flexShrink: 0,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: "linear-gradient(135deg,#15803d,#166534)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 15,
            }}>🏗</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>WBS Agent</div>
              <div style={{ fontSize: 10, color: "#475569" }}>
                {selectedProject ? selectedProject.projectName : t("subtitleWithoutProject")}
              </div>
            </div>
            {selectedProject && (
              <span style={{
                fontSize: 10, padding: "2px 7px", borderRadius: 20,
                background: "#14532d", color: "#4ade80", border: "1px solid #16a34a40",
              }}>
                {t("projectSelected")}
              </span>
            )}
            <button
              onClick={handleClose}
              style={{
                background: "none", border: "none", color: "#475569",
                cursor: "pointer", fontSize: 16, padding: "0 2px", lineHeight: 1,
              }}>✕</button>
          </div>

          {/* 메시지 영역 */}
          <div style={{
            flex: 1, overflowY: "auto",
            padding: "12px 12px 4px", minHeight: 0,
          }}>
            {messages.map((msg, i) => <Bubble key={i} msg={msg} />)}

            {loading && (
              <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: "50%",
                  background: "linear-gradient(135deg,#15803d,#166534)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, marginRight: 6, flexShrink: 0,
                }}>🏗</div>
                <div style={{
                  padding: "8px 12px", borderRadius: "14px 14px 14px 4px",
                  background: "#1c2a3a", border: "1px solid #253347",
                  display: "flex", gap: 4, alignItems: "center",
                }}>
                  {[0, 1, 2].map(i => (
                    <span key={i} style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: "#22c55e",
                      animation: `wbs-bounce 1s ease-in-out ${i * 0.15}s infinite`,
                      display: "inline-block",
                    }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* 빠른 액션 */}
          {messages.length <= 1 && !loading && (
            <div style={{
              padding: "6px 10px 0",
              display: "flex", gap: 5, flexWrap: "wrap",
            }}>
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(action)}
                  style={{
                    padding: "4px 10px", borderRadius: 12, fontSize: 11,
                    background: "#0f2d1a", border: "1px solid #166534",
                    color: "#4ade80", cursor: "pointer",
                  }}>
                  {action}
                </button>
              ))}
            </div>
          )}

          {/* 입력창 */}
          <div style={{
            display: "flex", gap: 6, padding: "8px 10px",
            borderTop: "1px solid #166534", flexShrink: 0,
            background: "#06111c",
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedProject ? t("placeholderWithProject") : t("placeholderWithoutProject")}
              rows={1}
              disabled={loading}
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
              disabled={!input.trim() || loading}
              style={{
                width: 34, height: 34,
                borderRadius: 10, border: "none",
                background: (!input.trim() || loading)
                  ? "#1c2a3a" : "linear-gradient(135deg,#15803d,#166534)",
                color: (!input.trim() || loading) ? "#334155" : "#4ade80",
                cursor: (!input.trim() || loading) ? "not-allowed" : "pointer",
                fontSize: 15, flexShrink: 0, alignSelf: "flex-end",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
              ➤
            </button>
          </div>
        </div>
      )}

      {/* 플로팅 버튼 */}
      <button
        onClick={() => setOpen(v => !v)}
        title="WBS Agent"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: open
            ? "linear-gradient(135deg,#0f2d1a,#0a1521)"
            : "linear-gradient(135deg,#15803d,#166534)",
          border: `2px solid ${open ? "#22c55e" : "#22c55e80"}`,
          boxShadow: open
            ? "0 0 0 3px #22c55e30, 0 4px 20px #00000060"
            : "0 0 0 3px #22c55e20, 0 4px 20px #00000060",
          cursor: "pointer",
          zIndex: 9001,
          fontSize: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.2s ease",
        }}>
        {open ? "✕" : "🏗"}
      </button>

      <style>{`
        @keyframes wbs-bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </>
  );
}
