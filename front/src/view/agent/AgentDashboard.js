import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import AxiosCustom from '../../axios/AxiosCustom';

const API_CHAT = '/api/chat';

// ────────────────────────────────────────────────────
// 에이전트 능력 목록
// ────────────────────────────────────────────────────
const CAPABILITIES = [
  { icon: '🌡', title: '센서 데이터 조회', desc: '온도·습도 실시간 현황 및 이력 분석' },
  { icon: '📊', title: '데이터 시각화',   desc: '조회 결과를 라인 차트·지표 카드로 즉시 표시' },
  { icon: '🏗', title: 'BIM 요소 생성',   desc: '기둥·보·벽·슬래브 등 자연어로 생성/수정/삭제' },
  { icon: '🖼', title: '이미지 분석',     desc: '사진 업로드 후 AI 비전 모델로 내용 분석' },
  { icon: '🎤', title: '음성 대화',       desc: '마이크로 질문하고 TTS로 답변 청취' },
  { icon: '📄', title: '문서 내보내기',   desc: '대화 내용 및 센서 데이터를 CSV·TXT로 다운로드' },
];

// 조회 옵션
const METRIC_OPTIONS = [
  { value: 'both',        label: '온도 + 습도' },
  { value: 'temperature', label: '온도만' },
  { value: 'humidity',    label: '습도만' },
];
const COUNT_OPTIONS = [10, 20, 50, 100];

// ────────────────────────────────────────────────────
// 메인 컴포넌트
// ────────────────────────────────────────────────────
export default function AgentDashboard({ selectedProject, onBimUpdate }) {
  // ── 채팅 상태 ──
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '안녕하세요! AI Agent Studio입니다.\n음성·이미지·데이터 조회·BIM 작업을 모두 지원합니다.\n무엇을 도와드릴까요?',
      intent: 'chat',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `agent-${Date.now()}`);
  const bottomRef = useRef(null);

  // ── 음성 상태 ──
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const recognitionRef = useRef(null);

  // ── 이미지 상태 ──
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const imageInputRef = useRef(null);

  // ── 센서 데이터 상태 ──
  const [latestSensor, setLatestSensor] = useState(null);
  const [sensorLogs, setSensorLogs] = useState([]);      // 차트용 (포맷된)
  const [rawLogs, setRawLogs] = useState([]);             // 내보내기용 (원본)
  const [dataLoading, setDataLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState(null);

  // ── 데이터 조회 컨트롤 ──
  const [selectedMetric, setSelectedMetric] = useState('both');
  const [selectedCount, setSelectedCount] = useState(20);

  // ── 우측 패널 탭 ──
  const [activeTab, setActiveTab] = useState('data'); // 'data' | 'caps' | 'export'

  // ── STT 초기화 ──
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

  // ── 스크롤 ──
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── 센서 데이터 fetch ──
  const fetchSensorData = useCallback(async (count = selectedCount) => {
    setDataLoading(true);
    try {
      const [latestRes, logsRes] = await Promise.allSettled([
        AxiosCustom.get('/api/sensor/latest'),
        AxiosCustom.get('/api/sensor/logs'),
      ]);

      if (latestRes.status === 'fulfilled') {
        setLatestSensor(latestRes.value.data);
      }
      if (logsRes.status === 'fulfilled') {
        const raw = Array.isArray(logsRes.value.data) ? logsRes.value.data : [];
        const sliced = raw.slice(-count);
        setRawLogs(sliced);
        const formatted = sliced.map((d, i) => ({
          name: d.timestamp
            ? new Date(d.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
            : `${i + 1}`,
          온도: d.temperature ?? d.temp ?? null,
          습도: d.humidity ?? null,
        }));
        setSensorLogs(formatted);
        setLastFetched(new Date().toLocaleTimeString('ko-KR'));
      }
    } catch {
      // fetch 실패 무시
    } finally {
      setDataLoading(false);
    }
  }, [selectedCount]);

  // 마운트 시 최신 데이터 로드
  useEffect(() => {
    fetchSensorData(20);
  }, [fetchSensorData]);

  // ── TTS ──
  const speak = useCallback((text) => {
    if (!ttsEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'ko-KR';
    utt.rate = 1.0;
    window.speechSynthesis.speak(utt);
  }, [ttsEnabled]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('이 브라우저는 음성 인식을 지원하지 않습니다.');
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  // ── 이미지 ──
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
  const clearImage = () => { setImagePreview(null); setImageBase64(null); };

  // ── 메시지 전송 ──
  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && !imageBase64) || loading) return;

    const userContent = text || '이미지를 분석해주세요.';
    setMessages(prev => [...prev, { role: 'user', content: userContent, intent: null, image: imagePreview }]);
    setInput('');
    const capturedImage = imageBase64;
    clearImage();
    setLoading(true);

    try {
      let data;
      if (capturedImage) {
        const res = await AxiosCustom.post(`${API_CHAT}/multimodal`, {
          sessionId,
          message: userContent,
          imageBase64: capturedImage,
        });
        data = res.data;
      } else {
        const history = messages.map(m => ({ role: m.role, content: m.content }));
        const res = await AxiosCustom.post(`${API_CHAT}/message`, {
          sessionId,
          message: text,
          projectId: selectedProject?.projectId || null,
          history,
        });
        data = res.data;
      }

      setMessages(prev => [...prev, { role: 'assistant', content: data.response, intent: data.intent }]);
      speak(data.response);

      // 데이터 조회 응답이면 → 데이터 탭으로 전환 + 센서 새로고침
      if (data.intent === 'rag_db') {
        setActiveTab('data');
        fetchSensorData(selectedCount);
      }
      if (data.intent === 'bim_builder' && onBimUpdate) {
        onBimUpdate();
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        intent: 'chat',
      }]);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    await AxiosCustom.delete(`${API_CHAT}/history/${sessionId}`).catch(() => {});
    setMessages([{
      role: 'assistant',
      content: '대화 이력을 초기화했습니다. 새로운 대화를 시작해보세요!',
      intent: 'chat',
    }]);
  };

  // ── 내보내기 ──
  const exportChat = () => {
    const lines = messages.map(m =>
      `[${m.role === 'user' ? '사용자' : 'AI'}] ${m.content}`
    ).join('\n\n');
    downloadBlob(
      new Blob([lines], { type: 'text/plain;charset=utf-8' }),
      `agent-chat-${today()}.txt`,
    );
  };

  const exportSensorCSV = () => {
    if (!rawLogs.length) return;
    const keys = ['timestamp', 'location', 'temperature', 'humidity'];
    const header = keys.join(',');
    const rows = rawLogs.map(r => keys.map(k => r[k] ?? '').join(','));
    downloadBlob(
      new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' }),
      `sensor-${today()}.csv`,
    );
  };

  // ─────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────
  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
      {/* ── 상단 정보 바 ── */}
      <div className="flex items-center gap-3 mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-accent-green animate-pulse" />
          <span className="text-sm font-semibold text-gray-200">AI Agent Studio</span>
        </div>
        {selectedProject && (
          <span className="text-xs text-accent-blue bg-[#1e3a5f] border border-[#2a5080] px-2 py-0.5 rounded-full">
            BIM: {selectedProject.projectName}
          </span>
        )}
        <span className="text-xs text-gray-500 ml-auto">음성 · 이미지 · 데이터 조회 · BIM 생성</span>
      </div>

      {/* ── 메인 레이아웃 ── */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* ════ 좌측: 채팅 패널 ════ */}
        <div className="flex flex-col flex-1 min-w-0 bg-[#1c2a3a] border border-[#253347] rounded-2xl overflow-hidden">
          {/* 채팅 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#162032] border-b border-[#253347]">
            <span className="text-sm font-semibold text-gray-200">대화</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTtsEnabled(v => !v)}
                className={`text-sm flex items-center gap-1 px-2 py-1 rounded-lg transition-all ${
                  ttsEnabled
                    ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/40'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                🔊 {ttsEnabled ? 'TTS 켜짐' : 'TTS'}
              </button>
              <button onClick={clearHistory} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                초기화
              </button>
            </div>
          </div>

          {/* 메시지 영역 */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
            {messages.map((msg, i) => (
              <AgentMessageBubble key={i} msg={msg} />
            ))}
            {loading && <AgentTypingIndicator />}
            <div ref={bottomRef} />
          </div>

          {/* 이미지 미리보기 */}
          {imagePreview && (
            <div className="px-4 pt-3 bg-[#162032] border-t border-[#253347]">
              <div className="relative inline-block">
                <img src={imagePreview} alt="첨부" className="h-20 rounded-xl border border-[#253347] object-cover" />
                <button
                  onClick={clearImage}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-red-600 rounded-full text-white text-xs flex items-center justify-center hover:bg-red-500 shadow"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* 빠른 질문 */}
          <div className="px-4 pt-3 bg-[#162032] border-t border-[#253347]">
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map(q => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  className="text-xs bg-[#253347] hover:bg-[#2d4060] text-gray-400 hover:text-gray-200 px-3 py-1 rounded-full transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* 입력창 */}
          <div className="px-4 py-3 bg-[#162032]">
            <div className="flex items-center gap-2">
              <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
              <button
                onClick={() => imageInputRef.current?.click()}
                title="이미지 첨부"
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#253347] hover:bg-[#2d4060] text-gray-400 hover:text-gray-200 transition-colors text-base shrink-0"
              >
                📎
              </button>
              <button
                onClick={toggleListening}
                title={isListening ? '녹음 중지' : '음성 입력'}
                className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all text-base shrink-0 ${
                  isListening
                    ? 'bg-red-600/30 text-red-400 border border-red-600/50 animate-pulse'
                    : 'bg-[#253347] hover:bg-[#2d4060] text-gray-400 hover:text-gray-200'
                }`}
              >
                🎤
              </button>
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder={isListening ? '음성 인식 중...' : '메시지를 입력하거나 음성으로 말씀하세요...'}
                className="flex-1 bg-[#253347] text-gray-200 text-sm rounded-xl px-4 py-2.5 outline-none placeholder-gray-500 focus:ring-2 focus:ring-accent-blue/50"
              />
              <button
                onClick={sendMessage}
                disabled={loading || (!input.trim() && !imageBase64)}
                className="px-5 py-2.5 rounded-xl bg-accent-blue text-white text-sm font-semibold disabled:opacity-40 hover:bg-blue-500 transition-colors shrink-0"
              >
                전송
              </button>
            </div>
          </div>
        </div>

        {/* ════ 우측: 도구 패널 ════ */}
        <div className="w-80 xl:w-96 flex flex-col bg-[#1c2a3a] border border-[#253347] rounded-2xl overflow-hidden shrink-0">
          {/* 탭 */}
          <div className="flex border-b border-[#253347]">
            {[
              { id: 'data',   label: '📊 데이터' },
              { id: 'caps',   label: '🧠 능력'   },
              { id: 'export', label: '📄 내보내기' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-3 text-xs font-semibold transition-all ${
                  activeTab === tab.id
                    ? 'text-accent-blue border-b-2 border-accent-blue bg-[#162032]'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 탭 콘텐츠 */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {activeTab === 'data' && (
              <DataPanel
                latestSensor={latestSensor}
                sensorLogs={sensorLogs}
                loading={dataLoading}
                lastFetched={lastFetched}
                selectedMetric={selectedMetric}
                setSelectedMetric={setSelectedMetric}
                selectedCount={selectedCount}
                setSelectedCount={setSelectedCount}
                onQuery={() => fetchSensorData(selectedCount)}
              />
            )}
            {activeTab === 'caps' && <CapsPanel />}
            {activeTab === 'export' && (
              <ExportPanel
                onExportChat={exportChat}
                onExportSensor={exportSensorCSV}
                messageCount={messages.length}
                sensorCount={rawLogs.length}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────
// 데이터 조회 + 차트 패널
// ────────────────────────────────────────────────────
function DataPanel({
  latestSensor, sensorLogs, loading, lastFetched,
  selectedMetric, setSelectedMetric,
  selectedCount, setSelectedCount,
  onQuery,
}) {
  // 차트에 표시할 Line 결정
  const showTemp = selectedMetric === 'both' || selectedMetric === 'temperature';
  const showHum  = selectedMetric === 'both' || selectedMetric === 'humidity';

  return (
    <div className="p-3 space-y-3">
      {/* ── KPI 카드 ── */}
      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="현재 온도" value={latestSensor?.temperature} unit="°C" color="#2196f3" />
        <KpiCard label="현재 습도" value={latestSensor?.humidity}    unit="%"  color="#4caf50" />
      </div>

      {/* ── 데이터 조회 컨트롤 ── */}
      <div className="bg-[#162032] rounded-xl p-3 border border-[#253347] space-y-3">
        <p className="text-xs font-semibold text-gray-300">데이터 조회</p>

        {/* 조회 항목 선택 */}
        <div>
          <p className="text-xs text-gray-500 mb-1.5">조회 항목</p>
          <div className="flex gap-1 flex-wrap">
            {METRIC_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSelectedMetric(opt.value)}
                className={`text-xs px-3 py-1 rounded-full border transition-all ${
                  selectedMetric === opt.value
                    ? 'bg-accent-blue/20 text-accent-blue border-accent-blue/50'
                    : 'text-gray-400 border-[#253347] hover:border-gray-500'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 조회 개수 선택 */}
        <div>
          <p className="text-xs text-gray-500 mb-1.5">데이터 개수</p>
          <div className="flex gap-1">
            {COUNT_OPTIONS.map(n => (
              <button
                key={n}
                onClick={() => setSelectedCount(n)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                  selectedCount === n
                    ? 'bg-accent-blue/20 text-accent-blue border-accent-blue/50'
                    : 'text-gray-400 border-[#253347] hover:border-gray-500'
                }`}
              >
                {n}개
              </button>
            ))}
          </div>
        </div>

        {/* 조회 버튼 */}
        <button
          onClick={onQuery}
          disabled={loading}
          className="w-full py-2 rounded-xl bg-accent-blue text-white text-xs font-semibold disabled:opacity-40 hover:bg-blue-500 transition-colors flex items-center justify-center gap-1.5"
        >
          {loading ? (
            <>
              <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              조회 중...
            </>
          ) : (
            <>📊 조회 및 그래프 생성</>
          )}
        </button>

        {lastFetched && (
          <p className="text-xs text-gray-600 text-right">마지막 조회: {lastFetched}</p>
        )}
      </div>

      {/* ── 센서 차트 ── */}
      {sensorLogs.length > 0 ? (
        <div className="bg-[#162032] rounded-xl p-3 border border-[#253347]">
          <p className="text-xs font-semibold text-gray-400 mb-3">
            센서 이력 — 최근 {sensorLogs.length}건
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={sensorLogs} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#253347" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 9, fill: '#8896a4' }}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 9, fill: '#8896a4' }} />
              <Tooltip
                contentStyle={{ background: '#1c2a3a', border: '1px solid #253347', fontSize: 11, borderRadius: 8 }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {showTemp && (
                <Line
                  type="monotone"
                  dataKey="온도"
                  stroke="#2196f3"
                  dot={sensorLogs.length <= 20}
                  strokeWidth={2}
                  activeDot={{ r: 4 }}
                />
              )}
              {showHum && (
                <Line
                  type="monotone"
                  dataKey="습도"
                  stroke="#4caf50"
                  dot={sensorLogs.length <= 20}
                  strokeWidth={2}
                  activeDot={{ r: 4 }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        !loading && (
          <p className="text-xs text-gray-500 text-center py-6">
            위에서 조회 항목을 선택하고 [조회 및 그래프 생성]을 눌러보세요.
          </p>
        )
      )}
    </div>
  );
}

function KpiCard({ label, value, unit, color }) {
  const display = value != null ? Number(value).toFixed(1) : '—';
  return (
    <div className="rounded-xl p-3 bg-[#162032] border border-[#253347]" style={{ borderLeft: `3px solid ${color}` }}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-lg font-bold" style={{ color }}>
        {display}
        {value != null && <span className="text-xs font-normal text-gray-400 ml-1">{unit}</span>}
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────
// 능력 패널
// ────────────────────────────────────────────────────
function CapsPanel() {
  return (
    <div className="p-3 space-y-2">
      <p className="text-xs text-gray-500 mb-3">이 에이전트가 할 수 있는 것들:</p>
      {CAPABILITIES.map((cap, i) => (
        <div
          key={i}
          className="flex gap-3 items-start bg-[#162032] rounded-xl px-3 py-3 border border-[#253347] hover:border-accent-blue/40 transition-colors"
        >
          <span className="text-xl shrink-0">{cap.icon}</span>
          <div>
            <p className="text-xs font-semibold text-gray-200">{cap.title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{cap.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────
// 내보내기 패널
// ────────────────────────────────────────────────────
function ExportPanel({ onExportChat, onExportSensor, messageCount, sensorCount }) {
  return (
    <div className="p-4 space-y-4">
      <p className="text-xs text-gray-500">대화 내용 및 센서 데이터를 파일로 내려받습니다.</p>

      <ExportItem
        icon="💬"
        title="대화 내보내기"
        desc={`현재 대화 ${messageCount}건 → TXT`}
        label="다운로드"
        onClick={onExportChat}
        disabled={messageCount === 0}
      />
      <ExportItem
        icon="🌡"
        title="센서 데이터 CSV"
        desc={`조회된 센서 로그 ${sensorCount}건`}
        label="CSV 다운로드"
        onClick={onExportSensor}
        disabled={sensorCount === 0}
      />

      <div className="bg-[#162032] rounded-xl p-3 border border-[#253347] mt-2">
        <p className="text-xs text-gray-400 font-semibold mb-2">💡 사용 팁</p>
        <ul className="text-xs text-gray-500 space-y-1.5 list-disc list-inside">
          <li>🎤 마이크 버튼으로 음성 질문</li>
          <li>📎 이미지 첨부 후 AI 분석 요청</li>
          <li>🔊 TTS 켜면 AI 답변을 음성으로</li>
          <li>데이터 탭에서 항목·개수 선택 후 조회</li>
          <li>AI에게 "온도 알려줘" → 차트 자동 갱신</li>
        </ul>
      </div>
    </div>
  );
}

function ExportItem({ icon, title, desc, label, onClick, disabled }) {
  return (
    <div className="bg-[#162032] rounded-xl p-3 border border-[#253347] flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="text-xl">{icon}</span>
        <div>
          <p className="text-xs font-semibold text-gray-200">{title}</p>
          <p className="text-xs text-gray-500">{desc}</p>
        </div>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className="text-xs px-3 py-1.5 rounded-lg bg-accent-blue/20 text-accent-blue border border-accent-blue/30 hover:bg-accent-blue/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
      >
        {label}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────
// 메시지 버블
// ────────────────────────────────────────────────────
const INTENT_BADGE = {
  rag_db:      { label: '데이터 조회', color: 'text-green-400 bg-green-900/40 border-green-800/50'     },
  bim_builder: { label: 'BIM 작업',   color: 'text-blue-400 bg-blue-900/40 border-blue-800/50'       },
  vision:      { label: '이미지 분석', color: 'text-purple-400 bg-purple-900/40 border-purple-800/50' },
  chat: null,
};

function AgentMessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  const badge = INTENT_BADGE[msg.intent];
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        {!isUser && badge && (
          <span className={`text-xs px-2 py-0.5 rounded-full border ${badge.color}`}>{badge.label}</span>
        )}
        {msg.image && (
          <img src={msg.image} alt="첨부" className="rounded-2xl max-h-48 object-cover border border-[#253347] shadow" />
        )}
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words leading-relaxed ${
            isUser
              ? 'bg-accent-blue text-white rounded-br-sm'
              : 'bg-[#253347] text-gray-200 rounded-bl-sm'
          }`}
        >
          {msg.content}
        </div>
      </div>
    </div>
  );
}

function AgentTypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-[#253347] rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1.5 items-center">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
        <span className="text-xs text-gray-500 ml-1">AI 처리 중...</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────
// 유틸
// ────────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const QUICK_PROMPTS = [
  '현재 온도?', '온습도 현황', '기둥 추가', '피라미드 만들어', '이미지 분석해줘',
];
