import { useState, useEffect, useRef } from 'react';
import AxiosCustom from '../../axios/AxiosCustom';

const API_BASE = `/api/chat`;

/**
 * 플로팅 AI 채팅 패널
 * - 모든 뷰에서 우측 하단에 고정 표시
 * - BIM 프로젝트 컨텍스트를 자동으로 Agent에 전달
 * - rag_db / bim_builder / chat intent에 따라 뱃지 표시
 */
export default function ChatView({ selectedProject, onBimUpdate }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '안녕하세요! 디지털 트윈 AI 어시스턴트입니다.\n센서 데이터, 에너지 현황 조회, BIM 요소 생성 등을 도와드릴 수 있어요.',
      intent: 'chat',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `session-${Date.now()}`);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text, intent: null };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const { data } = await AxiosCustom.post(`${API_BASE}/message`, {
        sessionId,
        message: text,
        projectId: selectedProject?.projectId || null,
        history,
      });
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.response, intent: data.intent },
      ]);
      // BIM 부재 생성/수정/삭제 후 3D 뷰어 즉시 갱신
      if (data.intent === 'bim_builder' && onBimUpdate) {
        onBimUpdate();
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: '오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', intent: 'chat' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    await AxiosCustom.delete(`${API_BASE}/history/${sessionId}`).catch(() => {});
    setMessages([
      {
        role: 'assistant',
        content: '대화 이력을 초기화했습니다. 새로운 대화를 시작해보세요!',
        intent: 'chat',
      },
    ]);
  };

  return (
    <>
      {/* 플로팅 버튼 */}
      <button
        onClick={() => setIsOpen(o => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-accent-blue shadow-glow flex items-center justify-center text-white text-2xl hover:scale-110 transition-transform"
        title="AI 어시스턴트"
      >
        {isOpen ? '✕' : '🤖'}
      </button>

      {/* 채팅 패널 */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-96 h-[600px] flex flex-col rounded-2xl shadow-2xl border border-space-700 bg-space-900 overflow-hidden">
          {/* 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 bg-space-800 border-b border-space-700">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
              <span className="font-semibold text-sm text-gray-200">AI Agent</span>
              {selectedProject && (
                <span className="text-xs text-accent-blue bg-space-700 px-2 py-0.5 rounded-full">
                  {selectedProject.projectName}
                </span>
              )}
            </div>
            <button
              onClick={clearHistory}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              title="대화 초기화"
            >
              초기화
            </button>
          </div>

          {/* 메시지 목록 */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}
            {loading && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>

          {/* 입력창 */}
          <div className="px-3 py-3 bg-space-800 border-t border-space-700">
            {/* 빠른 질문 버튼 */}
            <div className="flex gap-1 mb-2 flex-wrap">
              {QUICK_PROMPTS.map(q => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  className="text-xs bg-space-700 hover:bg-space-600 text-gray-400 hover:text-gray-200 px-2 py-1 rounded-full transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder="메시지를 입력하세요..."
                className="flex-1 bg-space-700 text-gray-200 text-sm rounded-lg px-3 py-2 outline-none placeholder-gray-500 focus:ring-1 focus:ring-accent-blue"
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium disabled:opacity-40 hover:bg-blue-500 transition-colors"
              >
                전송
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── 서브 컴포넌트 ───────────────────────────────────────────────

const INTENT_BADGE = {
  rag_db: { label: '데이터 조회', color: 'text-accent-green bg-green-900/40' },
  bim_builder: { label: 'BIM 작업', color: 'text-accent-blue bg-blue-900/40' },
  chat: null,
};

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  const badge = INTENT_BADGE[msg.intent];

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {!isUser && badge && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${badge.color}`}>
            {badge.label}
          </span>
        )}
        <div
          className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
            isUser
              ? 'bg-accent-blue text-white rounded-br-sm'
              : 'bg-space-700 text-gray-200 rounded-bl-sm'
          }`}
        >
          {msg.content}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-space-700 rounded-2xl rounded-bl-sm px-4 py-2 flex gap-1 items-center">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

const QUICK_PROMPTS = ['현재 온도?', '에너지 현황', '기둥 추가', '알림 확인'];
