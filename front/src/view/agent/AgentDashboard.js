import { useState, useEffect, useRef, useCallback } from 'react';
import { useT, useLanguage } from '../../i18n/LanguageContext';
import {
  BarChart, Bar, Cell,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import AxiosCustom from '../../axios/AxiosCustom';
import { exportQuantityToExcel, exportToPDF } from '../../utils/exportUtils';

/** BCP-47 language tag for Web Speech API */
function getLangCode(lang) {
  if (lang === 'ja') return 'ja-JP';
  if (lang === 'en') return 'en-US';
  return 'ko-KR';
}

const API_CHAT = '/api/chat';

// SSE 스트리밍은 fetch() 로 호출 — AxiosCustom 은 스트리밍 미지원
// 상대경로로 쓰면 React 개발서버(3000)으로 날아가므로 환경별 base 명시
const SPRING_BASE = process.env.REACT_APP_API_URL
  || (process.env.NODE_ENV === 'development'
      ? `http://${window.location.hostname}:8080`
      : '');

// ── Agent step 상태 레이블 (다국어) ──────────────────────────────────────────
const STEP_LABELS = {
  ko: {
    classifying:       '질문 분류 중...',
    sensor_agent:      '센서 데이터 조회 중...',
    bim_agent:         'BIM Agent 처리 중...',
    simulation_agent:  '시뮬레이션 Agent 처리 중...',
    safe_agent:        '안전 모니터링 Agent 처리 중...',
    test_agent:        '충돌 테스트 Agent 처리 중...',
    orchestrator:      '통합 보고서 생성 중...',
    tab_guide:         '탭 안내 준비 중...',
    generating:        '답변 생성 중...',
  },
  en: {
    classifying:       'Classifying question...',
    sensor_agent:      'Fetching sensor data...',
    bim_agent:         'BIM Agent processing...',
    simulation_agent:  'Simulation Agent processing...',
    safe_agent:        'Safety Monitoring Agent processing...',
    test_agent:        'Collision Test Agent processing...',
    orchestrator:      'Generating integrated report...',
    tab_guide:         'Preparing tab guide...',
    generating:        'Generating response...',
  },
  ja: {
    classifying:       '質問を分類中...',
    sensor_agent:      'センサーデータ取得中...',
    bim_agent:         'BIM エージェント処理中...',
    simulation_agent:  'シミュレーションエージェント処理中...',
    safe_agent:        '安全監視エージェント処理中...',
    test_agent:        '衝突テストエージェント処理中...',
    orchestrator:      '統合レポート生成中...',
    tab_guide:         'タブガイドを準備中...',
    generating:        '回答を生成中...',
  },
};

const ELEMENT_TYPE_KOR = {
  IfcColumn: 'Column', IfcBeam: 'Beam', IfcWall: 'Wall', IfcSlab: 'Slab', IfcPier: 'Pier',
};
const ELEMENT_COLORS = ['#2196f3', '#4caf50', '#ff9800', '#e91e63', '#9c27b0', '#00bcd4'];

const COUNT_OPTIONS = [10, 20, 50, 100];

// ────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────
export default function AgentDashboard({ selectedProject, onBimUpdate, selectedSimulationProject, agentAvailable }) {
  const t = useT('agent');
  const { lang } = useLanguage();
  // ── Chat state ──
  const [messages, setMessages] = useState(() => [
    { role: 'assistant', content: t('greeting'), intent: 'chat' },
  ]);

  // Update greeting when language changes (only if conversation hasn't started)
  useEffect(() => {
    setMessages(prev =>
      prev.length === 1 && prev[0].role === 'assistant'
        ? [{ ...prev[0], content: t('greeting') }]
        : prev
    );
  }, [t]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `agent-${Date.now()}`);
  const bottomRef = useRef(null);

  // ── Voice state ──
  const [isListening, setIsListening] = useState(false);
  const [sttError, setSttError] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const recognitionRef = useRef(null);

  // ── Image state ──
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const imageInputRef = useRef(null);

  // ── Sensor data state ──
  const [latestSensor, setLatestSensor] = useState(null);
  const [sensorLogs, setSensorLogs] = useState([]);
  const [rawLogs, setRawLogs] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState(null);

  // ── Data query controls ──
  const [selectedMetric, setSelectedMetric] = useState('both');
  const [selectedCount, setSelectedCount] = useState(20);

  // ── BIM data state ──
  const [bimProjects, setBimProjects]   = useState([]);
  const [bimStats, setBimStats]         = useState([]);
  const [bimTotal, setBimTotal]         = useState(0);
  const [bimTargetProject, setBimTargetProject] = useState(null);
  const [bimLoading, setBimLoading]     = useState(false);

  // ── Report data (orchestrator) ──
  const [reportData, setReportData] = useState(null);

  // ── Right panel tab ──
  const [activeTab, setActiveTab] = useState('data');

  // STT: 인스턴스를 미리 만들지 않음 — toggleListening 호출 시마다 생성
  // (iOS Safari / Android: 동일 인스턴스 재사용 시 두 번째 호출부터 무응답)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Sensor data fetch ──
  const fetchSensorData = useCallback(async (count = selectedCount) => {
    setDataLoading(true);
    const locale = getLangCode(lang);
    try {
      const [latestRes, logsRes] = await Promise.allSettled([
        AxiosCustom.get('/api/sensor/latest'),
        AxiosCustom.get('/api/sensor/logs'),
      ]);
      if (latestRes.status === 'fulfilled') setLatestSensor(latestRes.value.data);
      if (logsRes.status === 'fulfilled') {
        const raw = Array.isArray(logsRes.value.data) ? logsRes.value.data : [];
        const sliced = raw.slice(-count);
        setRawLogs(sliced);
        setSensorLogs(sliced.map((d, i) => ({
          name: d.timestamp
            ? new Date(d.timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
            : `${i + 1}`,
          Temp: d.temperature ?? d.temp ?? null,
          Humidity: d.humidity ?? null,
        })));
        setLastFetched(new Date().toLocaleTimeString(locale));
      }
    } catch { /* 무시 */ } finally {
      setDataLoading(false);
    }
  }, [selectedCount, lang]);

  // Initial data load on mount
  useEffect(() => {
    fetchSensorData(20);
    AxiosCustom.get('/api/bim/db-projects')
      .then(res => setBimProjects(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  }, [fetchSensorData]);

  // ── BIM statistics query ──
  const fetchBimStats = useCallback(async (projectId) => {
    if (!projectId) return;
    setBimLoading(true);
    try {
      const res = await AxiosCustom.get(`/api/bim/stats/${projectId}`);
      const stats = Array.isArray(res.data) ? res.data : [];
      setBimStats(stats);
      setBimTotal(stats.reduce((sum, s) => sum + (Number(s.elementCount) || 0), 0));
    } catch {
      setBimStats([]); setBimTotal(0);
    } finally {
      setBimLoading(false);
    }
  }, []);

  // ── TTS ──
  const speak = useCallback((text) => {
    if (!ttsEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = getLangCode(lang); utt.rate = 1.0;
    window.speechSynthesis.speak(utt);
  }, [ttsEnabled, lang]);

  const toggleListening = useCallback(() => {
    // 중지 요청
    if (isListening) {
      try { recognitionRef.current?.stop(); } catch (_) {}
      setIsListening(false);
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setSttError(t('speechNotSupported'));
      return;
    }

    setSttError('');

    // 매번 새 인스턴스 생성 — iOS Safari / Android 재사용 불가 문제 해결
    const rec = new SR();
    rec.lang = getLangCode(lang);
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map(r => r[0].transcript)
        .join('');
      setInput(prev => prev ? `${prev} ${transcript}` : transcript);
      setIsListening(false);
    };

    rec.onend = () => setIsListening(false);

    rec.onerror = (e) => {
      setIsListening(false);
      if (e.error === 'not-allowed') {
        setSttError(t('sttNotAllowed'));
      } else if (e.error === 'no-speech') {
        setSttError(t('sttNoSpeech'));
      } else if (e.error !== 'aborted') {
        setSttError(`${t('sttError')}${e.error}`);
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setIsListening(true);
    } catch (err) {
      setSttError(`${t('sttError')}${err.message}`);
    }
  }, [isListening, lang, t]);

  // ── Image ──
  const handleImageSelect = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setImagePreview(reader.result); setImageBase64(reader.result); };
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  const clearImage = () => { setImagePreview(null); setImageBase64(null); };

  // ── Update chart from sensorData structured response ──
  const applySensorData = useCallback((sd) => {
    if (!sd) return;
    if (Array.isArray(sd.sensor) && sd.sensor.length > 0) {
      setSensorLogs(sd.sensor.map(r => ({
        name: r.time || '',
        Temp: r.temperature ?? null,
        Humidity: r.humidity ?? null,
      })));
    }
    if (sd.latest) {
      setLatestSensor(prev => ({ ...(prev || {}), ...sd.latest }));
    }
    setLastFetched(new Date().toLocaleTimeString(getLangCode(lang)));
  }, [lang]);

  // ── Send message (SSE streaming) ──
  const sendMessage = async (overrideText) => {
    const text = (typeof overrideText === 'string' ? overrideText : input).trim();
    if ((!text && !imageBase64) || loading) return;

    setSttError('');
    const userContent = text || t('imageAnalyze');
    setMessages(prev => [...prev, { role: 'user', content: userContent, intent: null, image: imagePreview }]);
    setInput('');
    const capturedImage = imageBase64;
    clearImage();
    setLoading(true);

    try {
      // 이미지(멀티모달)는 스트리밍 없이 기존 방식 유지
      if (capturedImage) {
        const res = await AxiosCustom.post(`${API_CHAT}/multimodal`, {
          sessionId, message: userContent, imageBase64: capturedImage,
        });
        const data = res.data;
        setMessages(prev => [...prev, {
          role: 'assistant', content: data.response, intent: data.intent,
        }]);
        speak(data.response);
        return;
      }

      // 텍스트 메시지: SSE 스트리밍
      const history = messages.map(m => ({ role: m.role, content: m.content }));

      // 빈 assistant 버블을 먼저 추가 — 초기 상태 "질문 분류 중..."
      const initStatus = (STEP_LABELS[lang] || STEP_LABELS.ko).classifying;
      setMessages(prev => [...prev, { role: 'assistant', content: '', intent: 'chat', _streaming: true, _status: initStatus }]);

      // SSE 스트리밍: Spring Gateway 경유 (/api/chat/stream)
      // fetch() 는 상대경로 시 React 개발서버(3000)로 날아가므로 SPRING_BASE 명시
      const response = await fetch(`${SPRING_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: text,
          uiLang: lang,
          projectId: selectedProject?.projectId || null,
          simulationProjectId: selectedSimulationProject?.projectId || null,
          history,
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const updateLastMsg = (updater) =>
        setMessages(prev => {
          const msgs = [...prev];
          msgs[msgs.length - 1] = updater(msgs[msgs.length - 1]);
          return msgs;
        });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 마지막 불완전한 줄은 다음 청크와 합침

        for (const line of lines) {
          // Spring SSE: "data:{json}"  (공백 없음)
          // Python SSE: "data: {json}" (공백 있음) — 직접 연결 시 대비
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();   // "data:" 5자 제거 + 앞뒤 공백 trim
          if (!raw) continue;

          let event;
          try { event = JSON.parse(raw); } catch { continue; }

          if (event.step) {
            // step 이벤트: 버블 상태 텍스트 업데이트
            const label = (STEP_LABELS[lang] || STEP_LABELS.ko)[event.step] || event.step;
            updateLastMsg(msg => ({ ...msg, _status: label }));
          } else if (event.done) {
            // 완료 이벤트: 구조화 데이터 처리
            updateLastMsg(msg => ({
              ...msg,
              content: event.response || msg.content,
              intent: event.intent,
              bimData: event.bimData || null,
              sensorData: event.sensorData || null,
              reportData: event.reportData || null,
              _streaming: false,
            }));
            speak(event.response || '');

            // 센서 데이터 갱신 — multi-agent(sensor_agent) + 레거시(rag_db) 모두 대응
            if (event.intent === 'sensor_agent' || event.intent === 'rag_db') {
              setActiveTab('data');
              if (event.sensorData) applySensorData(event.sensorData);
              else fetchSensorData(selectedCount);
            }
            // BIM 뷰어 갱신 — multi-agent(bim_agent) + 레거시(bim_builder)
            if ((event.intent === 'bim_agent' || event.intent === 'bim_builder') && onBimUpdate) onBimUpdate();
            // BIM 통계 패널 — multi-agent(bim_agent) + 레거시(bim_query)
            if ((event.intent === 'bim_agent' || event.intent === 'bim_query') && event.bimData) {
              setActiveTab('bim');
              if (event.bimData.projects) setBimProjects(event.bimData.projects);
              if (event.bimData.stats)    setBimStats(event.bimData.stats);
              if (event.bimData.total != null) setBimTotal(event.bimData.total);
              if (event.bimData.targetProjectId) {
                const proj = (event.bimData.projects || []).find(
                  p => p.projectId === event.bimData.targetProjectId
                );
                setBimTargetProject(proj || { projectId: event.bimData.targetProjectId });
              }
            }
            // 통합 보고서 — orchestrator
            if (event.intent === 'orchestrator' && event.reportData) {
              setReportData(event.reportData);
              setActiveTab('report');
            }
          } else if (event.content) {
            // 토큰 청크: 버블에 실시간 추가
            updateLastMsg(msg => ({ ...msg, content: msg.content + event.content }));
          }
        }
      }
    } catch {
      setMessages(prev => {
        const msgs = [...prev];
        // 스트리밍 중 오류: 버블이 이미 있으면 내용 교체, 없으면 새로 추가
        if (msgs.length && msgs[msgs.length - 1]._streaming) {
          msgs[msgs.length - 1] = { role: 'assistant', content: t('errorMsg'), intent: 'chat' };
          return msgs;
        }
        return [...msgs, { role: 'assistant', content: t('errorMsg'), intent: 'chat' }];
      });
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    await AxiosCustom.delete(`${API_CHAT}/history/${sessionId}`).catch(() => {});
    setMessages([{ role: 'assistant', content: t('clearHistory'), intent: 'chat' }]);
  };

  const exportChat = () => {
    const lines = messages.map(m => `[${m.role === 'user' ? 'User' : 'AI'}] ${m.content}`).join('\n\n');
    downloadBlob(new Blob([lines], { type: 'text/plain;charset=utf-8' }), `agent-chat-${today()}.txt`);
  };
  const exportSensorCSV = () => {
    if (!rawLogs.length) return;
    const keys = ['timestamp', 'location', 'temperature', 'humidity'];
    const header = keys.join(',');
    const rows = rawLogs.map(r => keys.map(k => r[k] ?? '').join(','));
    downloadBlob(new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' }), `sensor-${today()}.csv`);
  };

  const [bimExporting, setBimExporting] = useState(false);

  const handleBimExcelExport = async () => {
    if (!bimTargetProject) return;
    try {
      const res = await AxiosCustom.get(`/api/bim/project/${bimTargetProject.projectId}`);
      exportQuantityToExcel(res.data, bimTargetProject.projectName);
    } catch (e) {
      console.error('Excel export failed', e);
    }
  };

  const handleBimPdfExport = async () => {
    if (!bimTargetProject) return;
    setBimExporting(true);
    try {
      const res = await AxiosCustom.get(`/api/bim/project/${bimTargetProject.projectId}`);
      await exportToPDF(res.data, bimTargetProject.projectName);
    } catch (e) {
      console.error('PDF export failed', e);
    } finally {
      setBimExporting(false);
    }
  };

  // ─────────────────────────────────────────────────
  // Render
  const [mobilePanel, setMobilePanel] = useState('chat');

  // ─────────────────────────────────────────────────
  const chatDisabled = agentAvailable === false;

  return (
    <div className="flex flex-col lg:h-[calc(100vh-120px)]">
      {/* Top info bar */}
      <div className="flex items-center gap-3 mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-accent-green animate-pulse" />
          <span className="text-sm font-semibold text-gray-200">{t('agentStudio')}</span>
        </div>
        {selectedProject && (
          <span className="text-xs text-accent-blue bg-[#1e3a5f] border border-[#2a5080] px-2 py-0.5 rounded-full truncate max-w-[120px]">
            BIM: {selectedProject.projectName}
          </span>
        )}
        <span className="text-xs text-gray-500 ml-auto hidden sm:inline">{t('capabilities')}</span>
      </div>

      {/* Mobile panel tab switch */}
      <div className="lg:hidden flex gap-1 mb-3 bg-[#0d1b2a] border border-[#253347] rounded-xl p-1">
        {[{ id: 'chat', label: t('chatTab') }, { id: 'tools', label: t('tools') }].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setMobilePanel(id)}
            className="flex-1 py-2 text-sm font-semibold rounded-lg transition-all"
            style={{
              backgroundColor: mobilePanel === id ? '#1e3a5f' : 'transparent',
              color: mobilePanel === id ? '#60a5fa' : '#8896a4',
              border: mobilePanel === id ? '1px solid #2a5080' : '1px solid transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Main layout */}
      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">

        {/* ════ Left: Chat panel ════ */}
        <div className={`flex-col flex-1 min-w-0 bg-[#1c2a3a] border border-[#253347] rounded-2xl overflow-hidden ${mobilePanel === 'chat' ? 'flex' : 'hidden lg:flex'}`}>
          {/* Agent offline banner */}
          {chatDisabled && (
            <div className="flex items-center gap-2 px-4 py-2 bg-yellow-900/30 border-b border-yellow-700/40 text-xs text-yellow-400">
              <span>⚠</span>
              <span>{t('llmOffline')} — {t('llmOfflineDesc')}</span>
            </div>
          )}

          {/* Chat header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#162032] border-b border-[#253347]">
            <span className="text-sm font-semibold text-gray-200">{t('chat')}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTtsEnabled(v => !v)}
                className={`text-sm flex items-center gap-1 px-2 py-1 rounded-lg transition-all ${
                  ttsEnabled
                    ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/40'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                🔊 {ttsEnabled ? t('ttsOn') : t('tts')}
              </button>
              <button onClick={clearHistory} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                {t('reset')}
              </button>
            </div>
          </div>

          {/* Message area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-[50vh] lg:min-h-0">
            {messages.map((msg, i) => (
              <AgentMessageBubble key={i} msg={msg} />
            ))}
            {/* 이미지(멀티모달) 전송 시에만 별도 타이핑 인디케이터 표시 — 텍스트 스트리밍은 버블 안에 상태 표시 */}
            {loading && !messages.some(m => m._streaming) && <AgentTypingIndicator />}
            <div ref={bottomRef} />
          </div>

          {/* Image preview */}
          {imagePreview && (
            <div className="px-4 pt-3 bg-[#162032] border-t border-[#253347]">
              <div className="relative inline-block">
                <img src={imagePreview} alt="Attached" className="h-20 rounded-xl border border-[#253347] object-cover" />
                <button
                  onClick={clearImage}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-red-600 rounded-full text-white text-xs flex items-center justify-center hover:bg-red-500 shadow"
                >✕</button>
              </div>
            </div>
          )}

          {/* Quick prompts — context-aware */}
          {!chatDisabled && (
            <div className="px-3 sm:px-4 pt-2 pb-1 bg-[#162032] border-t border-[#253347]">
              <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {(selectedProject
                  ? [t('quickShowTemp'), t('quickMemberCount'), t('quickTabGuide')]
                  : selectedSimulationProject
                    ? [t('quickShowTemp'), t('quickSimStatus'), t('quickSimDig'), t('quickTestTab')]
                    : [t('quickShowTemp'), t('quickBimList'), t('quickSimTab'), t('quickTabGuide')]
                ).map(q => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="text-xs bg-[#253347] hover:bg-[#2d4060] text-gray-400 hover:text-gray-200 px-3 py-1 rounded-full transition-colors whitespace-nowrap shrink-0"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-[#162032]">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
              <button
                onClick={() => imageInputRef.current?.click()}
                disabled={chatDisabled}
                title="Attach image"
                className="hidden sm:flex w-9 h-9 items-center justify-center rounded-lg bg-[#253347] hover:bg-[#2d4060] text-gray-400 hover:text-gray-200 transition-colors text-base shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
              >📎</button>
              <button
                onClick={toggleListening}
                disabled={chatDisabled}
                title={isListening ? t('stopRecording') : t('voiceInput')}
                className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg transition-all text-sm sm:text-base shrink-0 disabled:opacity-30 disabled:cursor-not-allowed ${
                  isListening
                    ? 'bg-red-600/30 text-red-400 border border-red-600/50 animate-pulse'
                    : sttError
                      ? 'bg-yellow-900/30 text-yellow-500 border border-yellow-600/40'
                      : 'bg-[#253347] hover:bg-[#2d4060] text-gray-400 hover:text-gray-200'
                }`}
              >🎤</button>
              <input
                type="text"
                value={input}
                onChange={e => { setInput(e.target.value); setSttError(''); }}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !chatDisabled && sendMessage()}
                placeholder={chatDisabled ? t('llmOffline') : isListening ? t('listening') : t('typeOrSpeak')}
                disabled={chatDisabled}
                className="flex-1 min-w-0 bg-[#253347] text-gray-200 text-sm rounded-xl px-3 sm:px-4 py-2.5 outline-none placeholder-gray-500 focus:ring-2 focus:ring-accent-blue/50 disabled:opacity-40 disabled:cursor-not-allowed"
              />
              <button
                onClick={sendMessage}
                disabled={chatDisabled || loading || (!input.trim() && !imageBase64)}
                className="flex items-center justify-center gap-1 sm:px-5 px-3 py-2.5 rounded-xl bg-accent-blue text-white text-sm font-semibold disabled:opacity-40 hover:bg-blue-500 transition-colors shrink-0"
              >
                <span className="hidden sm:inline">{t('send')}</span>
                <svg className="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </div>
            {/* STT 오류 메시지 */}
            {sttError && (
              <p className="text-xs text-yellow-500 mt-1.5 px-1 flex items-center gap-1">
                <span>⚠</span>{sttError}
              </p>
            )}
          </div>
        </div>

        {/* ════ Right: Tools panel ════ */}
        <div className={`flex-col bg-[#1c2a3a] border border-[#253347] rounded-2xl overflow-hidden lg:w-80 xl:w-96 lg:shrink-0 ${mobilePanel === 'tools' ? 'flex' : 'hidden lg:flex'}`}>
          {/* Tabs */}
          <div className="flex border-b border-[#253347]">
            {[
              { id: 'data',   label: t('dataTab') },
              { id: 'bim',    label: t('bimTab')  },
              { id: 'report', label: t('reportTab') },
              { id: 'caps',   label: t('capsTab')  },
              { id: 'export', label: t('exportTab') },
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

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto min-h-[60vh] lg:min-h-0">
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
            {activeTab === 'bim' && (
              <BimPanel
                projects={bimProjects}
                stats={bimStats}
                total={bimTotal}
                targetProject={bimTargetProject}
                loading={bimLoading}
                onSelectProject={(proj) => { setBimTargetProject(proj); fetchBimStats(proj.projectId); }}
                onOpenProject={() => { if (onBimUpdate) onBimUpdate(); }}
              />
            )}
            {activeTab === 'report' && (
              <ReportPanel reportData={reportData} />
            )}
            {activeTab === 'caps' && <CapsPanel />}
            {activeTab === 'export' && (
              <ExportPanel
                onExportChat={exportChat}
                onExportSensor={exportSensorCSV}
                onExportBimCsv={() => {
                  if (bimTargetProject) window.open(`/api/bim/export/${bimTargetProject.projectId}`, '_blank');
                }}
                onExportBimExcel={handleBimExcelExport}
                onExportBimPdf={handleBimPdfExport}
                messageCount={messages.length}
                sensorCount={rawLogs.length}
                bimProjectName={bimTargetProject?.projectName || null}
                bimExporting={bimExporting}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────
// Data panel (sensor + energy chart)
// ────────────────────────────────────────────────────
function DataPanel({
  latestSensor, sensorLogs, loading, lastFetched,
  selectedMetric, setSelectedMetric,
  selectedCount, setSelectedCount,
  onQuery,
}) {
  const t = useT('agent');
  const showTemp = selectedMetric === 'both' || selectedMetric === 'temperature';
  const showHum  = selectedMetric === 'both' || selectedMetric === 'humidity';

  const METRIC_OPTIONS = [
    { value: 'both',        label: t('tempHumidity') },
    { value: 'temperature', label: t('tempOnly') },
    { value: 'humidity',    label: t('humOnly') },
  ];

  return (
    <div className="p-3 space-y-3">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-2">
        <KpiCard label={t('currentTemp')} value={latestSensor?.temperature} unit="°C" color="#2196f3" />
        <KpiCard label={t('currentHumidity')} value={latestSensor?.humidity}    unit="%"  color="#4caf50" />
      </div>

      {/* Data query controls */}
      <div className="bg-[#162032] rounded-xl p-3 border border-[#253347] space-y-3">
        <p className="text-xs font-semibold text-gray-300">{t('dataQuery')}</p>

        <div>
          <p className="text-xs text-gray-500 mb-1.5">{t('queryItems')}</p>
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

        <div>
          <p className="text-xs text-gray-500 mb-1.5">{t('dataCount')}</p>
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
                {n}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onQuery}
          disabled={loading}
          className="w-full py-2 rounded-xl bg-accent-blue text-white text-xs font-semibold disabled:opacity-40 hover:bg-blue-500 transition-colors flex items-center justify-center gap-1.5"
        >
          {loading ? (
            <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />{t('querying')}</>
          ) : <>{t('queryChart')}</>}
        </button>

        {lastFetched && (
          <p className="text-xs text-gray-600 text-right">{t('lastFetched')} {lastFetched}</p>
        )}
      </div>

      {/* ── Sensor chart (temp/humidity) ── */}
      {sensorLogs && sensorLogs.length > 0 && (
        <div className="bg-[#162032] rounded-xl p-3 border border-[#253347]">
          <p className="text-xs font-semibold text-gray-400 mb-3">
            {t('sensorHistory', { n: sensorLogs.length })}
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={sensorLogs} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              <defs>
                <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2196f3" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#2196f3" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="humGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4caf50" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4caf50" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#253347" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#8896a4' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: '#8896a4' }} />
              <Tooltip contentStyle={{ background: '#1c2a3a', border: '1px solid #253347', fontSize: 11, borderRadius: 8 }} labelStyle={{ color: '#e2e8f0' }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {showTemp && (
                <Area type="monotone" dataKey="Temp" stroke="#2196f3" fill="url(#tempGrad)"
                  dot={sensorLogs.length <= 20} strokeWidth={2} activeDot={{ r: 4 }} />
              )}
              {showHum && (
                <Area type="monotone" dataKey="Humidity" stroke="#4caf50" fill="url(#humGrad)"
                  dot={sensorLogs.length <= 20} strokeWidth={2} activeDot={{ r: 4 }} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Empty state guidance */}
      {!loading && sensorLogs.length === 0 && (
        <p className="text-xs text-gray-500 text-center py-6">
          {t('queryHint')}
          <br /><span className="opacity-60">{t('chatHint')}</span>
        </p>
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
// Capabilities panel
// ────────────────────────────────────────────────────
function CapsPanel() {
  const t = useT('agent');
  const CAPABILITIES = [
    { icon: '🌡', title: t('cap1Title'), desc: t('cap1Desc') },
    { icon: '📊', title: t('cap2Title'), desc: t('cap2Desc') },
    { icon: '🏗', title: t('cap3Title'), desc: t('cap3Desc') },
    { icon: '📋', title: t('cap4Title'), desc: t('cap4Desc') },
    { icon: '🚜', title: t('cap5Title'), desc: t('cap5Desc') },
    { icon: '🖼', title: t('cap6Title'), desc: t('cap6Desc') },
    { icon: '🎤', title: t('cap7Title'), desc: t('cap7Desc') },
    { icon: '📄', title: t('cap8Title'), desc: t('cap8Desc') },
  ];
  return (
    <div className="p-3 space-y-2">
      <p className="text-xs text-gray-500 mb-3">{t('capsTitle')}</p>
      {CAPABILITIES.map((cap, i) => (
        <div key={i} className="flex gap-3 items-start bg-[#162032] rounded-xl px-3 py-3 border border-[#253347] hover:border-accent-blue/40 transition-colors">
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
// Export panel
// ────────────────────────────────────────────────────
function ExportPanel({
  onExportChat, onExportSensor,
  onExportBimCsv, onExportBimExcel, onExportBimPdf,
  messageCount, sensorCount, bimProjectName, bimExporting,
}) {
  const t = useT('agent');
  const bimDesc = bimProjectName ? `${bimProjectName}` : t('selectProjectInBimTab');
  return (
    <div className="p-4 space-y-3">
      <p className="text-xs text-gray-500 mb-1">{t('exportTitle')}</p>

      {/* Chat / Sensor */}
      <ExportItem icon="💬" title={t('exportChat')} desc={t('exportChatDesc', { n: messageCount })} label={t('download')} onClick={onExportChat} disabled={messageCount === 0} />
      <ExportItem icon="🌡" title={t('sensorCsv')} desc={t('sensorCsvDesc', { n: sensorCount })} label={t('csv')} onClick={onExportSensor} disabled={sensorCount === 0} />

      {/* BIM quantity report */}
      <div className="bg-[#162032] rounded-xl p-3 border border-[#253347] space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">🏗</span>
          <div>
            <p className="text-xs font-semibold text-gray-200">{t('bimMemberExport')}</p>
            <p className="text-xs text-gray-500">{bimDesc}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={onExportBimCsv}
            disabled={!bimProjectName}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg bg-[#253347] text-gray-300 border border-[#334155]
                       hover:bg-[#2d4060] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            📋 {t('csv')}
          </button>
          <button
            onClick={onExportBimExcel}
            disabled={!bimProjectName}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg bg-emerald-800/40 text-emerald-300 border border-emerald-700/50
                       hover:bg-emerald-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {t('quantitySheet')}
          </button>
          <button
            onClick={onExportBimPdf}
            disabled={!bimProjectName || bimExporting}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg bg-purple-800/40 text-purple-300 border border-purple-700/50
                       hover:bg-purple-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {bimExporting ? t('generating') : t('pdfDrawing')}
          </button>
        </div>
      </div>

      <div className="bg-[#162032] rounded-xl p-3 border border-[#253347] mt-1">
        <p className="text-xs text-gray-400 font-semibold mb-2">{t('tips')}</p>
        <ul className="text-xs text-gray-500 space-y-1.5 list-disc list-inside">
          <li>{t('tip1')}</li>
          <li>{t('tip2')}</li>
          <li>{t('tip3')}</li>
          <li>{t('tip4')}</li>
          <li>{t('tip5')}</li>
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
      <button onClick={onClick} disabled={disabled}
        className="text-xs px-3 py-1.5 rounded-lg bg-accent-blue/20 text-accent-blue border border-accent-blue/30 hover:bg-accent-blue/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0">
        {label}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────
// BIM panel
// ────────────────────────────────────────────────────
function BimPanel({ projects, stats, total, targetProject, loading, onSelectProject }) {
  const t = useT('agent');
  const TYPE_COLORS = {
    IfcColumn: '#2196f3', IfcBeam: '#4caf50', IfcWall: '#ff9800',
    IfcSlab: '#e91e63', IfcPier: '#9c27b0',
  };
  const chartData = stats.map(s => ({
    name: ELEMENT_TYPE_KOR[s.elementType] || s.elementType,
    Count: Number(s.elementCount) || 0,
    type: s.elementType,
  }));

  return (
    <div className="p-3 space-y-3">
      <div className="bg-[#162032] rounded-xl p-3 border border-[#253347]">
        <p className="text-xs font-semibold text-gray-300 mb-2">{t('projectList', { n: projects.length })}</p>
        {projects.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-3">{t('noProjects')}<br /><span className="opacity-60">{t('askBimList')}</span></p>
        ) : (
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {projects.map(p => {
              const isSelected = targetProject?.projectId === p.projectId;
              return (
                <button key={p.projectId} onClick={() => onSelectProject(p)}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all"
                  style={{ backgroundColor: isSelected ? '#1e3a5f' : '#1c2a3a', border: `1px solid ${isSelected ? '#2a5080' : '#253347'}` }}>
                  <span className="text-base shrink-0">{p.structureType === 'Building' ? '🏢' : '🌉'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-200 truncate">{p.projectName}</p>
                    <p className="text-xs text-gray-500">{p.structureType}</p>
                  </div>
                  {isSelected && <span className="text-xs text-accent-blue shrink-0">{t('selected')}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {targetProject && (
        <div className="bg-[#162032] rounded-xl p-3 border border-[#253347]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-300">{t('memberStats', { name: targetProject.projectName })}</p>
            {loading
              ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
              : <span className="text-xs text-gray-500">{t('total', { n: total })}</span>}
          </div>

          {!loading && stats.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-1.5 mb-3">
                {stats.map(s => (
                  <div key={s.elementType} className="rounded-lg p-2 text-center"
                    style={{ backgroundColor: '#0d1b2a', borderLeft: `3px solid ${TYPE_COLORS[s.elementType] || '#60a5fa'}` }}>
                    <p className="text-xs text-gray-500">{ELEMENT_TYPE_KOR[s.elementType] || s.elementType}</p>
                    <p className="text-sm font-bold" style={{ color: TYPE_COLORS[s.elementType] || '#60a5fa' }}>{s.elementCount}</p>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#253347" />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#8896a4' }} />
                  <YAxis tick={{ fontSize: 9, fill: '#8896a4' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#1c2a3a', border: '1px solid #253347', fontSize: 11, borderRadius: 8 }} labelStyle={{ color: '#e2e8f0' }} />
                  <Bar dataKey="Count" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={TYPE_COLORS[entry.type] || ELEMENT_COLORS[i % ELEMENT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
          {!loading && stats.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-3">{t('noMemberData')}</p>
          )}
        </div>
      )}

      {!targetProject && (
        <p className="text-xs text-gray-500 text-center py-4">
          {t('selectProjectForStats')}
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────
// Message bubble
// ────────────────────────────────────────────────────

function AgentMessageBubble({ msg }) {
  const t = useT('agent');
  const INTENT_BADGE = {
    // ── 레거시 intent 값 ──────────────────────────────────────────────────
    rag_db:           { label: t('intentDataQuery'),       color: 'text-green-400 bg-green-900/40 border-green-800/50'     },
    bim_builder:      { label: t('intentBimOperation'),    color: 'text-blue-400 bg-blue-900/40 border-blue-800/50'        },
    bim_query:        { label: t('intentBimQuery'),        color: 'text-cyan-400 bg-cyan-900/40 border-cyan-800/50'        },
    tab_guide:        { label: t('intentTabGuide'),        color: 'text-amber-400 bg-amber-900/40 border-amber-800/50'     },
    vision:           { label: t('intentImageAnalysis'),   color: 'text-purple-400 bg-purple-900/40 border-purple-800/50'  },
    // ── Multi-Agent intent 값 ────────────────────────────────────────────
    sensor_agent:     { label: t('intentDataQuery'),       color: 'text-green-400 bg-green-900/40 border-green-800/50'     },
    bim_agent:        { label: t('intentBimOperation'),    color: 'text-blue-400 bg-blue-900/40 border-blue-800/50'        },
    simulation_agent: { label: t('intentSimulation'),      color: 'text-indigo-400 bg-indigo-900/40 border-indigo-800/50'  },
    safe_agent:       { label: t('intentSafety'),          color: 'text-red-400 bg-red-900/40 border-red-800/50'           },
    test_agent:       { label: t('intentCollisionTest'),   color: 'text-orange-400 bg-orange-900/40 border-orange-800/50'  },
    orchestrator:     { label: t('intentReport'),                  color: 'text-teal-400 bg-teal-900/40 border-teal-800/50' },
    chat: null,
  };
  const isUser = msg.role === 'user';
  const badge = INTENT_BADGE[msg.intent];

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[90%] flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
        {!isUser && badge && (
          <span className={`text-xs px-2 py-0.5 rounded-full border ${badge.color}`}>{badge.label}</span>
        )}
        {msg.image && (
          <img src={msg.image} alt="Attached" className="rounded-2xl max-h-48 object-cover border border-[#253347] shadow" />
        )}
        <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words leading-relaxed ${
          isUser ? 'bg-accent-blue text-white rounded-br-sm' : 'bg-[#253347] text-gray-200 rounded-bl-sm'
        }`}>
          {/* 스트리밍 중이고 아직 토큰이 없으면 step 상태 표시 */}
          {msg._streaming && !msg.content ? (
            <span className="flex items-center gap-2">
              <span className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <span key={i} className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
              <span className="text-gray-400 text-xs">{msg._status}</span>
            </span>
          ) : (
            msg.content
          )}
        </div>

        {/* Sensor data inline chart — multi-agent(sensor_agent) + 레거시(rag_db) */}
        {!isUser && (msg.intent === 'sensor_agent' || msg.intent === 'rag_db') && msg.sensorData && (
          <SensorInlineChart sensorData={msg.sensorData} />
        )}

        {/* BIM query inline summary — multi-agent(bim_agent) + 레거시(bim_query) */}
        {!isUser && (msg.intent === 'bim_agent' || msg.intent === 'bim_query') && msg.bimData && (
          <BimInlineSummary bimData={msg.bimData} />
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────
// Sensor inline chart (inside chat bubble)
// ────────────────────────────────────────────────────
function SensorInlineChart({ sensorData }) {
  const t = useT('agent');
  const { sensor = [], latest, alerts = [] } = sensorData;

  const sensorRows = sensor.map(r => ({
    name: r.time || '',
    Temp: r.temperature ?? null,
    Humidity: r.humidity ?? null,
  }));

  return (
    <div className="w-full space-y-2 mt-1">
      {/* Latest KPI */}
      {latest && (
        <div className="grid grid-cols-2 gap-1.5">
          {latest.temperature != null && (
            <div className="rounded-lg px-3 py-2 bg-[#162032] border border-[#253347]" style={{ borderLeft: '3px solid #2196f3' }}>
              <p className="text-xs text-gray-500">Temp</p>
              <p className="text-base font-bold text-blue-400">{Number(latest.temperature).toFixed(1)}<span className="text-xs text-gray-400 ml-1">°C</span></p>
            </div>
          )}
          {latest.humidity != null && (
            <div className="rounded-lg px-3 py-2 bg-[#162032] border border-[#253347]" style={{ borderLeft: '3px solid #4caf50' }}>
              <p className="text-xs text-gray-500">Humidity</p>
              <p className="text-base font-bold text-green-400">{Number(latest.humidity).toFixed(1)}<span className="text-xs text-gray-400 ml-1">%</span></p>
            </div>
          )}
        </div>
      )}

      {/* Sensor area chart */}
      {sensorRows.length > 1 && (
        <div className="bg-[#162032] rounded-xl p-3 border border-[#253347]">
          <p className="text-xs font-semibold text-gray-400 mb-2">{t('sensorHistory', { n: sensorRows.length })}</p>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={sensorRows} margin={{ top: 4, right: 8, bottom: 4, left: -24 }}>
              <defs>
                <linearGradient id="inlineTempGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2196f3" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#2196f3" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="inlineHumGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4caf50" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4caf50" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#253347" />
              <XAxis dataKey="name" tick={{ fontSize: 8, fill: '#8896a4' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 8, fill: '#8896a4' }} />
              <Tooltip contentStyle={{ background: '#1c2a3a', border: '1px solid #253347', fontSize: 10, borderRadius: 8 }} labelStyle={{ color: '#e2e8f0' }} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              {sensorRows.some(r => r.Temp != null) && (
                <Area type="monotone" dataKey="Temp" stroke="#2196f3" fill="url(#inlineTempGrad)"
                  dot={false} strokeWidth={2} activeDot={{ r: 3 }} />
              )}
              {sensorRows.some(r => r.Humidity != null) && (
                <Area type="monotone" dataKey="Humidity" stroke="#4caf50" fill="url(#inlineHumGrad)"
                  dot={false} strokeWidth={2} activeDot={{ r: 3 }} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Alert list */}
      {alerts.length > 0 && (
        <div className="bg-[#162032] rounded-xl border border-[#253347] overflow-hidden">
          <div className="px-3 py-2 border-b border-[#253347]">
            <span className="text-xs font-semibold text-yellow-400">⚠ Alerts ({alerts.length})</span>
          </div>
          <div className="divide-y divide-[#253347] max-h-32 overflow-y-auto">
            {alerts.slice(0, 5).map((a, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-1.5">
                <span className="text-xs text-gray-500 shrink-0 mt-0.5">{a.time}</span>
                <span className="text-xs text-gray-300 flex-1">{a.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────
// BIM inline summary
// ────────────────────────────────────────────────────
function BimInlineSummary({ bimData }) {
  const t = useT('agent');
  const { projects, stats, total } = bimData;
  const TYPE_COLORS = {
    IfcColumn: '#2196f3', IfcBeam: '#4caf50', IfcWall: '#ff9800',
    IfcSlab: '#e91e63', IfcPier: '#9c27b0',
  };

  return (
    <div className="w-full space-y-2">
      {projects && projects.length > 0 && (
        <div className="bg-[#162032] rounded-xl border border-[#253347] overflow-hidden">
          <div className="px-3 py-2 border-b border-[#253347]">
            <span className="text-xs font-semibold text-gray-300">{t('projectList', { n: projects.length })}</span>
          </div>
          <div className="divide-y divide-[#253347]">
            {projects.slice(0, 5).map(p => (
              <div key={p.projectId} className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-sm">{p.structureType === 'Building' ? '🏢' : '🌉'}</span>
                <span className="text-xs text-gray-200 flex-1 truncate">{p.projectName}</span>
                <span className="text-xs text-gray-500">{p.structureType}</span>
              </div>
            ))}
            {projects.length > 5 && (
              <div className="px-3 py-1.5 text-xs text-gray-500 text-center">{t('moreProjects', { n: projects.length - 5 })}</div>
            )}
          </div>
        </div>
      )}

      {stats && stats.length > 0 && (
        <div className="bg-[#162032] rounded-xl border border-[#253347] overflow-hidden">
          <div className="px-3 py-2 border-b border-[#253347]">
            <span className="text-xs font-semibold text-gray-300">📊 {t('total', { n: total || 0 })}</span>
          </div>
          <div className="divide-y divide-[#253347]">
            {stats.map(s => {
              const pct = total > 0 ? Math.round((Number(s.elementCount) / total) * 100) : 0;
              return (
                <div key={s.elementType} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="text-xs text-gray-400 w-12 shrink-0">{ELEMENT_TYPE_KOR[s.elementType] || s.elementType}</span>
                  <div className="flex-1 h-1.5 bg-[#253347] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: TYPE_COLORS[s.elementType] || '#60a5fa' }} />
                  </div>
                  <span className="text-xs font-semibold shrink-0" style={{ color: TYPE_COLORS[s.elementType] || '#60a5fa' }}>{s.elementCount}</span>
                  <span className="text-xs text-gray-600 w-8 text-right shrink-0">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentTypingIndicator() {
  const t = useT('agent');
  return (
    <div className="flex justify-start">
      <div className="bg-[#253347] rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1.5 items-center">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
        <span className="text-xs text-gray-500 ml-1">{t('aiProcessing')}</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────
// Report panel (orchestrator output)
// ────────────────────────────────────────────────────
function ReportPanel({ reportData }) {
  const t = useT('agent');
  if (!reportData) {
    return (
      <div className="p-4 flex flex-col items-center justify-center text-center gap-3 py-12">
        <span className="text-4xl opacity-30">📄</span>
        <p className="text-xs text-gray-500">{t('reportNoData')}</p>
        <p className="text-xs text-gray-600 opacity-60">{t('reportNoDataHint')}</p>
      </div>
    );
  }

  const handleDownload = () => {
    const content = `# ${reportData.title}\n${t('reportGeneratedAt')} ${reportData.generatedAt}\n\n${reportData.content}`;
    downloadBlob(new Blob([content], { type: 'text/markdown;charset=utf-8' }), `report-${reportData.generatedAt?.slice(0, 10) || today()}.md`);
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-teal-400">{reportData.title}</p>
          <p className="text-xs text-gray-500 mt-0.5">{t('reportGeneratedAt')} {reportData.generatedAt}</p>
        </div>
        <button
          onClick={handleDownload}
          className="text-xs px-3 py-1.5 rounded-lg bg-teal-800/40 text-teal-300 border border-teal-700/50 hover:bg-teal-700/50 transition-colors shrink-0"
        >
          ↓ MD
        </button>
      </div>
      <div className="bg-[#162032] rounded-xl border border-[#253347] p-3 overflow-y-auto max-h-[calc(100vh-340px)]">
        <SimpleMarkdown content={reportData.content} />
      </div>
    </div>
  );
}

// Lightweight Markdown renderer (no external deps)
// Handles: headings, tables, blockquotes, bullet lists, bold/italic, horizontal rules
function SimpleMarkdown({ content }) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const h1 = line.match(/^#\s+(.*)/);
    if (h1) { elements.push(<h1 key={i} className="text-sm font-bold text-gray-100 mt-3 mb-1">{inlineMarkdown(h1[1])}</h1>); i++; continue; }
    if (h2) { elements.push(<h2 key={i} className="text-xs font-bold text-teal-300 mt-3 mb-1 border-b border-[#253347] pb-1">{inlineMarkdown(h2[1])}</h2>); i++; continue; }
    if (h3) { elements.push(<h3 key={i} className="text-xs font-semibold text-gray-200 mt-2 mb-0.5">{inlineMarkdown(h3[1])}</h3>); i++; continue; }

    // Blockquote
    if (line.startsWith('> ')) {
      elements.push(<p key={i} className="text-xs text-gray-400 italic border-l-2 border-teal-600 pl-2 my-1">{inlineMarkdown(line.slice(2))}</p>);
      i++; continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} className="border-[#253347] my-2" />);
      i++; continue;
    }

    // Table: collect all consecutive table lines
    if (line.startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      // separator row is "|---|---|"
      const rows = tableLines.filter(l => !/^\|[-| :]+\|$/.test(l.trim()));
      elements.push(
        <div key={i} className="overflow-x-auto my-2">
          <table className="w-full text-xs border-collapse">
            <tbody>
              {rows.map((row, ri) => {
                const cells = row.split('|').filter((_, ci) => ci > 0 && ci < row.split('|').length - 1);
                const isHeader = ri === 0;
                return (
                  <tr key={ri} className={isHeader ? 'bg-[#1e3a4a]' : ri % 2 === 0 ? 'bg-[#0d1b2a]' : 'bg-[#162032]'}>
                    {cells.map((cell, ci) => isHeader ? (
                      <th key={ci} className="px-2 py-1 text-left text-teal-300 font-semibold border border-[#253347] whitespace-nowrap">{inlineMarkdown(cell.trim())}</th>
                    ) : (
                      <td key={ci} className="px-2 py-1 text-gray-300 border border-[#253347]">{inlineMarkdown(cell.trim())}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Bullet list item
    const bullet = line.match(/^[-*]\s+(.*)/);
    if (bullet) {
      elements.push(
        <div key={i} className="flex gap-1.5 text-xs text-gray-300 my-0.5">
          <span className="text-teal-400 shrink-0 mt-0.5">•</span>
          <span>{inlineMarkdown(bullet[1])}</span>
        </div>
      );
      i++; continue;
    }

    // Empty line
    if (line.trim() === '') { elements.push(<div key={i} className="h-1" />); i++; continue; }

    // Regular paragraph
    elements.push(<p key={i} className="text-xs text-gray-300 leading-relaxed">{inlineMarkdown(line)}</p>);
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

function inlineMarkdown(text) {
  // bold **text** or __text__
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-gray-100">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('__') && part.endsWith('__')) {
      return <strong key={i} className="font-semibold text-gray-100">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

// ────────────────────────────────────────────────────
// Utils
// ────────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

