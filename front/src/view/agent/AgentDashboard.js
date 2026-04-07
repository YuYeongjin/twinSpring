import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import AxiosCustom from '../../axios/AxiosCustom';

const API_CHAT = '/api/chat';
const COLORS = ['#2196f3', '#4caf50', '#ff9800', '#f44336', '#9c27b0', '#00bcd4'];

// ────────────────────────────────────────────────────
// 에이전트 능력 목록
// ────────────────────────────────────────────────────
const CAPABILITIES = [
  { icon: '🌡', title: '센서 데이터 조회', desc: '온도·습도 실시간 현황 및 이력 분석' },
  { icon: '⚡', title: '에너지 관리', desc: '시간별·구역별 전력 소비 현황 및 비용 계산' },
  { icon: '🏗', title: 'BIM 요소 생성', desc: '기둥·보·벽·슬래브 등 자연어로 생성/수정/삭제' },
  { icon: '🖼', title: '이미지 분석', desc: '사진 업로드 후 AI 비전 모델로 내용 분석' },
  { icon: '🎤', title: '음성 대화', desc: '마이크로 질문하고 TTS로 답변 청취' },
  { icon: '📄', title: '문서 생성', desc: '대화 내용 및 데이터를 CSV·TXT로 내보내기' },
];

// ────────────────────────────────────────────────────
// 메인 컴포넌트
// ────────────────────────────────────────────────────
export default function AgentDashboard({ selectedProject, onBimUpdate }) {
  // ── 채팅 상태 ──
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '안녕하세요! AI Agent Studio에 오신 걸 환영합니다.\n음성, 이미지, 데이터 조회, BIM 작업까지 모두 지원합니다.\n무엇을 도와드릴까요?',
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

  // ── 데이터 상태 ──
  const [sensorLogs, setSensorLogs] = useState([]);
  const [energyTrend, setEnergyTrend] = useState([]);
  const [zoneData, setZoneData] = useState([]);
  const [latestSensor, setLatestSensor] = useState(null);
  const [emsSummary, setEmsSummary] = useState(null);
  const [dataLoading, setDataLoading] = useState(true);

  // ── 우측 패널 탭 ──
  const [activeTab, setActiveTab] = useState('charts'); // 'charts' | 'caps' | 'export'

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

  // ── 데이터 fetch ──
  const fetchData = useCallback(async () => {
    try {
      const [sensorRes, logsRes, trendRes, zoneRes, summaryRes] = await Promise.allSettled([
        AxiosCustom.get('/api/sensor/latest'),
        AxiosCustom.get('/api/sensor/logs'),
        AxiosCustom.get('/api/ems/trend/hourly'),
        AxiosCustom.get('/api/ems/zone'),
        AxiosCustom.get('/api/ems/summary'),
      ]);

      if (sensorRes.status === 'fulfilled') setLatestSensor(sensorRes.value.data);
      if (logsRes.status === 'fulfilled') {
        const raw = logsRes.value.data;
        const formatted = (Array.isArray(raw) ? raw : []).slice(-20).map((d, i) => ({
          name: d.timestamp ? new Date(d.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : `t${i}`,
          온도: d.temperature ?? d.temp ?? null,
          습도: d.humidity ?? null,
        }));
        setSensorLogs(formatted);
      }
      if (trendRes.status === 'fulfilled') {
        const raw = trendRes.value.data;
        const formatted = (Array.isArray(raw) ? raw : []).map(d => ({
          name: d.hour !== undefined ? `${d.hour}시` : (d.time ?? d.timestamp ?? ''),
          전력: d.power_kw ?? d.powerKw ?? d.value ?? 0,
        }));
        setEnergyTrend(formatted);
      }
      if (zoneRes.status === 'fulfilled') {
        const raw = zoneRes.value.data;
        setZoneData(Array.isArray(raw) ? raw.map(d => ({
          name: d.zone ?? d.name ?? d.zoneName ?? '구역',
          value: d.energy_kwh ?? d.energyKwh ?? d.consumption ?? d.value ?? 0,
        })) : []);
      }
      if (summaryRes.status === 'fulfilled') setEmsSummary(summaryRes.value.data);
    } catch {
      // 데이터 fetch 실패는 무시
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

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

      if (data.intent === 'rag_db') {
        setActiveTab('charts');
        fetchData();
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
    const lines = messages.map(m => `[${m.role === 'user' ? '사용자' : 'AI'}] ${m.content}`).join('\n\n');
    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSensorCSV = () => {
    if (!sensorLogs.length) return;
    const header = Object.keys(sensorLogs[0]).join(',');
    const rows = sensorLogs.map(r => Object.values(r).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sensor-data-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportEnergyCSV = () => {
    if (!energyTrend.length) return;
    const header = Object.keys(energyTrend[0]).join(',');
    const rows = energyTrend.map(r => Object.values(r).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `energy-trend-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
        <span className="text-xs text-gray-500 ml-auto">음성·이미지·데이터 조회·BIM 생성 통합 에이전트</span>
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
                title={ttsEnabled ? 'TTS 켜짐 (클릭하여 끄기)' : 'TTS 꺼짐 (클릭하여 켜기)'}
                className={`text-sm flex items-center gap-1 px-2 py-1 rounded-lg transition-all ${
                  ttsEnabled ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/40' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                🔊 {ttsEnabled ? 'TTS 켜짐' : 'TTS'}
              </button>
              <button
                onClick={clearHistory}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
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
              {/* 이미지 첨부 */}
              <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
              <button
                onClick={() => imageInputRef.current?.click()}
                title="이미지 첨부"
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#253347] hover:bg-[#2d4060] text-gray-400 hover:text-gray-200 transition-colors text-base shrink-0"
              >
                📎
              </button>

              {/* 음성 입력 */}
              <button
                onClick={toggleListening}
                title={isListening ? '녹음 중지' : '음성 입력 (ko-KR)'}
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
              { id: 'charts', label: '📊 차트' },
              { id: 'caps',   label: '🧠 능력' },
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
            {activeTab === 'charts' && (
              <ChartsPanel
                sensorLogs={sensorLogs}
                energyTrend={energyTrend}
                zoneData={zoneData}
                latestSensor={latestSensor}
                emsSummary={emsSummary}
                loading={dataLoading}
                onRefresh={fetchData}
              />
            )}
            {activeTab === 'caps' && <CapsPanel />}
            {activeTab === 'export' && (
              <ExportPanel
                onExportChat={exportChat}
                onExportSensor={exportSensorCSV}
                onExportEnergy={exportEnergyCSV}
                messageCount={messages.length}
                sensorCount={sensorLogs.length}
                energyCount={energyTrend.length}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────
// 차트 패널
// ────────────────────────────────────────────────────
function ChartsPanel({ sensorLogs, energyTrend, zoneData, latestSensor, emsSummary, loading, onRefresh }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
        데이터 로딩 중...
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4">
      {/* 새로고침 */}
      <div className="flex justify-end">
        <button
          onClick={onRefresh}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
        >
          🔄 새로고침
        </button>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 gap-2">
        <KpiCard
          label="현재 온도"
          value={latestSensor?.temperature ?? '—'}
          unit="°C"
          color="#2196f3"
        />
        <KpiCard
          label="현재 습도"
          value={latestSensor?.humidity ?? '—'}
          unit="%"
          color="#4caf50"
        />
        <KpiCard
          label="현재 전력"
          value={emsSummary?.currentPowerKw ?? emsSummary?.current_power_kw ?? '—'}
          unit="kW"
          color="#ff9800"
        />
        <KpiCard
          label="누적 전력"
          value={emsSummary?.totalEnergyKwh ?? emsSummary?.total_energy_kwh ?? '—'}
          unit="kWh"
          color="#9c27b0"
        />
      </div>

      {/* 센서 시계열 차트 */}
      {sensorLogs.length > 0 && (
        <ChartSection title="센서 이력 (온도·습도)">
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={sensorLogs} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#253347" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#8896a4' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: '#8896a4' }} />
              <Tooltip
                contentStyle={{ background: '#1c2a3a', border: '1px solid #253347', fontSize: 11 }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="온도" stroke="#2196f3" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="습도" stroke="#4caf50" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>
      )}

      {/* 에너지 추이 차트 */}
      {energyTrend.length > 0 && (
        <ChartSection title="시간별 전력 소비 (kW)">
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={energyTrend} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#253347" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#8896a4' }} interval={2} />
              <YAxis tick={{ fontSize: 9, fill: '#8896a4' }} />
              <Tooltip
                contentStyle={{ background: '#1c2a3a', border: '1px solid #253347', fontSize: 11 }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Bar dataKey="전력" fill="#ff9800" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>
      )}

      {/* 구역별 파이 차트 */}
      {zoneData.length > 0 && (
        <ChartSection title="구역별 에너지 분포">
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie
                data={zoneData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={60}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
                fontSize={9}
              >
                {zoneData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#1c2a3a', border: '1px solid #253347', fontSize: 11 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartSection>
      )}

      {!sensorLogs.length && !energyTrend.length && !zoneData.length && (
        <p className="text-xs text-gray-500 text-center py-6">
          데이터가 없습니다. AI에게 "현재 온도" 또는 "에너지 현황"을 물어보세요.
        </p>
      )}
    </div>
  );
}

function KpiCard({ label, value, unit, color }) {
  return (
    <div
      className="rounded-xl p-3 bg-[#162032] border border-[#253347]"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-lg font-bold" style={{ color }}>
        {value !== '—' && value !== null && value !== undefined ? Number(value).toFixed(1) : '—'}
        <span className="text-xs font-normal text-gray-400 ml-1">{unit}</span>
      </p>
    </div>
  );
}

function ChartSection({ title, children }) {
  return (
    <div className="bg-[#162032] rounded-xl p-3 border border-[#253347]">
      <p className="text-xs font-semibold text-gray-400 mb-2">{title}</p>
      {children}
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
function ExportPanel({ onExportChat, onExportSensor, onExportEnergy, messageCount, sensorCount, energyCount }) {
  return (
    <div className="p-4 space-y-4">
      <p className="text-xs text-gray-500">대화 내용 및 데이터를 파일로 내려받습니다.</p>

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
        desc={`센서 로그 ${sensorCount}건`}
        label="CSV 다운로드"
        onClick={onExportSensor}
        disabled={sensorCount === 0}
      />
      <ExportItem
        icon="⚡"
        title="에너지 추이 CSV"
        desc={`시간별 전력 데이터 ${energyCount}건`}
        label="CSV 다운로드"
        onClick={onExportEnergy}
        disabled={energyCount === 0}
      />

      <div className="bg-[#162032] rounded-xl p-3 border border-[#253347] mt-4">
        <p className="text-xs text-gray-400 font-semibold mb-2">💡 사용 팁</p>
        <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
          <li>🎤 마이크 버튼으로 음성 질문</li>
          <li>📎 이미지 첨부 후 AI 분석 요청</li>
          <li>🔊 TTS 켜면 AI 답변을 음성으로</li>
          <li>데이터 조회 후 차트 탭에서 시각화</li>
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
  rag_db:      { label: '데이터 조회', color: 'text-green-400 bg-green-900/40 border-green-800/50' },
  bim_builder: { label: 'BIM 작업',   color: 'text-blue-400 bg-blue-900/40 border-blue-800/50'   },
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
          <span className={`text-xs px-2 py-0.5 rounded-full border ${badge.color}`}>
            {badge.label}
          </span>
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

const QUICK_PROMPTS = [
  '현재 온도?', '에너지 현황', '기둥 추가', '알림 확인',
  '피라미드 만들어', '이미지 분석해줘',
];
