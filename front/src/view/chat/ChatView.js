import { useState, useEffect, useRef, useCallback } from 'react';
import AxiosCustom from '../../axios/AxiosCustom';

const API_BASE = `/api/chat`;

/**
 * 플로팅 AI 채팅 패널
 * - 모든 뷰에서 우측 하단에 고정 표시 (Agent 화면 제외)
 * - 음성 입력(STT) / 음성 출력(TTS) / 이미지 업로드 지원
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

  // 음성 관련
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const recognitionRef = useRef(null);

  // 이미지 관련
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const imageInputRef = useRef(null);

  const bottomRef = useRef(null);

  // STT 초기화
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'ko-KR';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      setInput(e.results[0][0].transcript);
      setIsListening(false);
    };
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    recognitionRef.current = rec;
  }, []);

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const speak = useCallback((text) => {
    if (!ttsEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'ko-KR';
    utt.rate = 1.0;
    window.speechSynthesis.speak(utt);
  }, [ttsEnabled]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImagePreview(reader.result);
      setImageBase64(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const clearImage = () => {
    setImagePreview(null);
    setImageBase64(null);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && !imageBase64) || loading) return;

    const userContent = text || '이미지를 분석해주세요.';
    const userMsg = {
      role: 'user',
      content: userContent,
      intent: null,
      image: imagePreview,
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    const capturedImage = imageBase64;
    clearImage();
    setLoading(true);

    try {
      let data;
      if (capturedImage) {
        const res = await AxiosCustom.post(`${API_BASE}/multimodal`, {
          sessionId,
          message: userContent,
          imageBase64: capturedImage,
        });
        data = res.data;
      } else {
        const history = messages.map(m => ({ role: m.role, content: m.content }));
        const res = await AxiosCustom.post(`${API_BASE}/message`, {
          sessionId,
          message: text,
          projectId: selectedProject?.projectId || null,
          history,
        });
        data = res.data;
      }

      const assistantMsg = { role: 'assistant', content: data.response, intent: data.intent };
      setMessages(prev => [...prev, assistantMsg]);
      speak(data.response);

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
            <div className="flex items-center gap-2">
              {/* TTS 토글 */}
              <button
                onClick={() => setTtsEnabled(v => !v)}
                title={ttsEnabled ? '음성 출력 켜짐' : '음성 출력 꺼짐'}
                className={`text-sm px-1.5 py-0.5 rounded transition-colors ${ttsEnabled ? 'text-accent-blue' : 'text-gray-500 hover:text-gray-300'}`}
              >
                🔊
              </button>
              <button
                onClick={clearHistory}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                title="대화 초기화"
              >
                초기화
              </button>
            </div>
          </div>

          {/* 메시지 목록 */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}
            {loading && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>

          {/* 이미지 미리보기 */}
          {imagePreview && (
            <div className="px-3 pt-2 bg-space-800 border-t border-space-700">
              <div className="relative inline-block">
                <img src={imagePreview} alt="첨부" className="h-16 rounded-lg border border-space-600 object-cover" />
                <button
                  onClick={clearImage}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 rounded-full text-white text-xs flex items-center justify-center hover:bg-red-500"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

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
            <div className="flex gap-2 items-center">
              {/* 이미지 업로드 */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageSelect}
              />
              <button
                onClick={() => imageInputRef.current?.click()}
                title="이미지 첨부"
                className="text-gray-400 hover:text-gray-200 transition-colors text-lg shrink-0"
              >
                📎
              </button>

              {/* 음성 입력 */}
              <button
                onClick={toggleListening}
                title={isListening ? '녹음 중지' : '음성 입력'}
                className={`text-lg shrink-0 transition-colors ${isListening ? 'text-red-400 animate-pulse' : 'text-gray-400 hover:text-gray-200'}`}
              >
                🎤
              </button>

              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder={isListening ? '음성 인식 중...' : '메시지를 입력하세요...'}
                className="flex-1 bg-space-700 text-gray-200 text-sm rounded-lg px-3 py-2 outline-none placeholder-gray-500 focus:ring-1 focus:ring-accent-blue"
              />
              <button
                onClick={sendMessage}
                disabled={loading || (!input.trim() && !imageBase64)}
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
  rag_db:      { label: '데이터 조회', color: 'text-accent-green bg-green-900/40' },
  bim_builder: { label: 'BIM 작업',   color: 'text-accent-blue bg-blue-900/40'   },
  vision:      { label: '이미지 분석', color: 'text-purple-400 bg-purple-900/40'  },
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
        {msg.image && (
          <img src={msg.image} alt="첨부 이미지" className="rounded-xl max-h-40 object-cover border border-space-600" />
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
