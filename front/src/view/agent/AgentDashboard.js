import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LineChart, Line,
  BarChart, Bar, Cell,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import AxiosCustom from '../../axios/AxiosCustom';
import { exportQuantityToExcel, exportToPDF } from '../../utils/exportUtils';

const API_CHAT = '/api/chat';

// ────────────────────────────────────────────────────
// Agent capabilities list
// ────────────────────────────────────────────────────
const CAPABILITIES = [
  { icon: '🌡', title: 'Sensor Data Query', desc: 'Real-time temperature/humidity status and history analysis' },
  { icon: '📊', title: 'Data Visualization',   desc: 'Display query results instantly as line/area/bar charts' },
  { icon: '🏗', title: 'BIM Element Creation',   desc: 'Create/modify/delete columns, beams, walls, slabs via natural language' },
  { icon: '📋', title: 'BIM Project Query', desc: 'Interactive query of project list, member count, and type statistics' },
  { icon: '🚜', title: 'Simulation Control', desc: 'Control excavator pose, angle, position, and presets via natural language' },
  { icon: '🖼', title: 'Image Analysis',     desc: 'Upload photos and analyze content with AI vision model' },
  { icon: '🎤', title: 'Voice Chat',       desc: 'Ask questions via microphone and listen to answers via TTS' },
  { icon: '📄', title: 'Document Export',   desc: 'Download conversation, sensor, and BIM data as CSV/TXT' },
];

const ELEMENT_TYPE_KOR = {
  IfcColumn: 'Column', IfcBeam: 'Beam', IfcWall: 'Wall', IfcSlab: 'Slab', IfcPier: 'Pier',
};
const ELEMENT_COLORS = ['#2196f3', '#4caf50', '#ff9800', '#e91e63', '#9c27b0', '#00bcd4'];

const METRIC_OPTIONS = [
  { value: 'both',        label: 'Temp + Humidity' },
  { value: 'temperature', label: 'Temp only' },
  { value: 'humidity',    label: 'Humidity only' },
];
const COUNT_OPTIONS = [10, 20, 50, 100];

// ────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────
export default function AgentDashboard({ selectedProject, onBimUpdate, selectedSimulationProject, agentAvailable }) {
  // ── Chat state ──
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Hello! This is AI Agent Studio.\nSupports voice, image, data query, and BIM tasks.\nHow can I help you?',
      intent: 'chat',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `agent-${Date.now()}`);
  const bottomRef = useRef(null);

  // ── Voice state ──
  const [isListening, setIsListening] = useState(false);
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

  // ── Right panel tab ──
  const [activeTab, setActiveTab] = useState('data');

  // ── STT initialization ──
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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Sensor data fetch ──
  const fetchSensorData = useCallback(async (count = selectedCount) => {
    setDataLoading(true);
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
            ? new Date(d.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
            : `${i + 1}`,
          Temp: d.temperature ?? d.temp ?? null,
          Humidity: d.humidity ?? null,
        })));
        setLastFetched(new Date().toLocaleTimeString('en-US'));
      }
    } catch { /* 무시 */ } finally {
      setDataLoading(false);
    }
  }, [selectedCount]);

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
    utt.lang = 'ko-KR'; utt.rate = 1.0;
    window.speechSynthesis.speak(utt);
  }, [ttsEnabled]);

  const toggleListening = () => {
    if (!recognitionRef.current) { alert('This browser does not support speech recognition.'); return; }
    if (isListening) { recognitionRef.current.stop(); }
    else { recognitionRef.current.start(); setIsListening(true); }
  };

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
    setLastFetched(new Date().toLocaleTimeString('en-US'));
  }, []);

  // ── Send message ──
  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && !imageBase64) || loading) return;

    const userContent = text || 'Please analyze this image.';
    setMessages(prev => [...prev, { role: 'user', content: userContent, intent: null, image: imagePreview }]);
    setInput('');
    const capturedImage = imageBase64;
    clearImage();
    setLoading(true);

    try {
      let data;
      if (capturedImage) {
        const res = await AxiosCustom.post(`${API_CHAT}/multimodal`, {
          sessionId, message: userContent, imageBase64: capturedImage,
        });
        data = res.data;
      } else {
        const history = messages.map(m => ({ role: m.role, content: m.content }));
        const res = await AxiosCustom.post(`${API_CHAT}/message`, {
          sessionId, message: text,
          projectId: selectedProject?.projectId || null,
          simulationProjectId: selectedSimulationProject?.projectId || null,
          history,
        });
        data = res.data;
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response,
        intent: data.intent,
        bimData: data.bimData,
        sensorData: data.sensorData,
      }]);
      speak(data.response);

      if (data.intent === 'rag_db') {
        setActiveTab('data');
        if (data.sensorData) {
          applySensorData(data.sensorData);
        } else {
          fetchSensorData(selectedCount);
        }
      }
      if (data.intent === 'bim_builder' && onBimUpdate) onBimUpdate();
      if (data.intent === 'bim_query') {
        setActiveTab('bim');
        if (data.bimData) {
          if (data.bimData.projects) setBimProjects(data.bimData.projects);
          if (data.bimData.stats)    setBimStats(data.bimData.stats);
          if (data.bimData.total != null) setBimTotal(data.bimData.total);
          if (data.bimData.targetProjectId) {
            const proj = (data.bimData.projects || []).find(
              p => p.projectId === data.bimData.targetProjectId
            );
            setBimTargetProject(proj || { projectId: data.bimData.targetProjectId });
          }
        }
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant', content: 'An error occurred. Please try again later.', intent: 'chat',
      }]);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    await AxiosCustom.delete(`${API_CHAT}/history/${sessionId}`).catch(() => {});
    setMessages([{ role: 'assistant', content: 'Conversation history cleared. Start a new conversation!', intent: 'chat' }]);
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
  if (agentAvailable === false) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <span className="text-5xl opacity-30">🤖</span>
        <p className="text-gray-400 font-semibold">Local PC LLM Not Available</p>
        <p className="text-gray-600 text-sm">Local PC LLM is not currently in use. Please use it later.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:h-[calc(100vh-120px)]">
      {/* Top info bar */}
      <div className="flex items-center gap-3 mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-accent-green animate-pulse" />
          <span className="text-sm font-semibold text-gray-200">AI Agent Studio</span>
        </div>
        {selectedProject && (
          <span className="text-xs text-accent-blue bg-[#1e3a5f] border border-[#2a5080] px-2 py-0.5 rounded-full truncate max-w-[120px]">
            BIM: {selectedProject.projectName}
          </span>
        )}
        <span className="text-xs text-gray-500 ml-auto hidden sm:inline">Voice · Image · Data Query · BIM Creation</span>
      </div>

      {/* Mobile panel tab switch */}
      <div className="lg:hidden flex gap-1 mb-3 bg-[#0d1b2a] border border-[#253347] rounded-xl p-1">
        {[{ id: 'chat', label: '💬 Chat' }, { id: 'tools', label: '🛠 Tools' }].map(({ id, label }) => (
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
          {/* Chat header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#162032] border-b border-[#253347]">
            <span className="text-sm font-semibold text-gray-200">Chat</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTtsEnabled(v => !v)}
                className={`text-sm flex items-center gap-1 px-2 py-1 rounded-lg transition-all ${
                  ttsEnabled
                    ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/40'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                🔊 {ttsEnabled ? 'TTS On' : 'TTS'}
              </button>
              <button onClick={clearHistory} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                Reset
              </button>
            </div>
          </div>

          {/* Message area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-[50vh] lg:min-h-0">
            {messages.map((msg, i) => (
              <AgentMessageBubble key={i} msg={msg} />
            ))}
            {loading && <AgentTypingIndicator />}
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

          {/* Quick prompts */}
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

          {/* Input area */}
          <div className="px-4 py-3 bg-[#162032]">
            <div className="flex items-center gap-2">
              <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
              <button
                onClick={() => imageInputRef.current?.click()}
                title="Attach image"
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#253347] hover:bg-[#2d4060] text-gray-400 hover:text-gray-200 transition-colors text-base shrink-0"
              >📎</button>
              <button
                onClick={toggleListening}
                title={isListening ? 'Stop recording' : 'Voice input'}
                className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all text-base shrink-0 ${
                  isListening
                    ? 'bg-red-600/30 text-red-400 border border-red-600/50 animate-pulse'
                    : 'bg-[#253347] hover:bg-[#2d4060] text-gray-400 hover:text-gray-200'
                }`}
              >🎤</button>
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder={isListening ? 'Listening...' : 'Type a message or speak...'}
                className="flex-1 bg-[#253347] text-gray-200 text-sm rounded-xl px-4 py-2.5 outline-none placeholder-gray-500 focus:ring-2 focus:ring-accent-blue/50"
              />
              <button
                onClick={sendMessage}
                disabled={loading || (!input.trim() && !imageBase64)}
                className="px-5 py-2.5 rounded-xl bg-accent-blue text-white text-sm font-semibold disabled:opacity-40 hover:bg-blue-500 transition-colors shrink-0"
              >Send</button>
            </div>
          </div>
        </div>

        {/* ════ Right: Tools panel ════ */}
        <div className={`flex-col bg-[#1c2a3a] border border-[#253347] rounded-2xl overflow-hidden lg:w-80 xl:w-96 lg:shrink-0 ${mobilePanel === 'tools' ? 'flex' : 'hidden lg:flex'}`}>
          {/* Tabs */}
          <div className="flex border-b border-[#253347]">
            {[
              { id: 'data',   label: '📊 Sensor' },
              { id: 'bim',    label: '🏗 BIM'  },
              { id: 'caps',   label: '🧠 Capabilities'  },
              { id: 'export', label: '📄 Export' },
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
  const showTemp = selectedMetric === 'both' || selectedMetric === 'temperature';
  const showHum  = selectedMetric === 'both' || selectedMetric === 'humidity';

  return (
    <div className="p-3 space-y-3">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="Current Temp" value={latestSensor?.temperature} unit="°C" color="#2196f3" />
        <KpiCard label="Current Humidity" value={latestSensor?.humidity}    unit="%"  color="#4caf50" />
      </div>

      {/* Data query controls */}
      <div className="bg-[#162032] rounded-xl p-3 border border-[#253347] space-y-3">
        <p className="text-xs font-semibold text-gray-300">Data Query</p>

        <div>
          <p className="text-xs text-gray-500 mb-1.5">Query Items</p>
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
          <p className="text-xs text-gray-500 mb-1.5">Data Count</p>
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
            <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />Querying...</>
          ) : <>📊 Query &amp; Generate Chart</>}
        </button>

        {lastFetched && (
          <p className="text-xs text-gray-600 text-right">Last fetched: {lastFetched}</p>
        )}
      </div>

      {/* ── Sensor chart (temp/humidity) ── */}
      {sensorLogs && sensorLogs.length > 0 && (
        <div className="bg-[#162032] rounded-xl p-3 border border-[#253347]">
          <p className="text-xs font-semibold text-gray-400 mb-3">
            🌡 Sensor History — Latest {sensorLogs.length} records
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
          Select a query item above and click [Query &amp; Generate Chart].
          <br /><span className="opacity-60">Or say "Show temperature graph" in the chat.</span>
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
  return (
    <div className="p-3 space-y-2">
      <p className="text-xs text-gray-500 mb-3">What this agent can do:</p>
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
  const bimDesc = bimProjectName ? `${bimProjectName}` : 'Select a project from the BIM tab';
  return (
    <div className="p-4 space-y-3">
      <p className="text-xs text-gray-500 mb-1">Download conversation and data as files.</p>

      {/* Chat / Sensor */}
      <ExportItem icon="💬" title="Export Chat" desc={`Current chat ${messageCount} messages → TXT`} label="Download" onClick={onExportChat} disabled={messageCount === 0} />
      <ExportItem icon="🌡" title="Sensor Data CSV" desc={`Queried sensor logs ${sensorCount} records`} label="CSV" onClick={onExportSensor} disabled={sensorCount === 0} />

      {/* BIM quantity report */}
      <div className="bg-[#162032] rounded-xl p-3 border border-[#253347] space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">🏗</span>
          <div>
            <p className="text-xs font-semibold text-gray-200">BIM Member Export</p>
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
            📋 CSV
          </button>
          <button
            onClick={onExportBimExcel}
            disabled={!bimProjectName}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg bg-emerald-800/40 text-emerald-300 border border-emerald-700/50
                       hover:bg-emerald-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            📊 Quantity Sheet
          </button>
          <button
            onClick={onExportBimPdf}
            disabled={!bimProjectName || bimExporting}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg bg-purple-800/40 text-purple-300 border border-purple-700/50
                       hover:bg-purple-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {bimExporting ? '⏳ Generating...' : '📄 PDF Drawing'}
          </button>
        </div>
      </div>

      <div className="bg-[#162032] rounded-xl p-3 border border-[#253347] mt-1">
        <p className="text-xs text-gray-400 font-semibold mb-2">💡 Tips</p>
        <ul className="text-xs text-gray-500 space-y-1.5 list-disc list-inside">
          <li>Select a project from the BIM tab to download Quantity Sheet / PDF</li>
          <li>Quantity Sheet (Excel): Summary + full member list in 2 sheets</li>
          <li>PDF Drawing: Report + 3D view screenshot (when using BIM editor)</li>
          <li>🎤 Use the microphone button for voice questions</li>
          <li>📎 Attach an image and request AI analysis</li>
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
        <p className="text-xs font-semibold text-gray-300 mb-2">🏗 Project List ({projects.length})</p>
        {projects.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-3">No projects found.<br /><span className="opacity-60">Ask "Show my BIM project list"</span></p>
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
                  {isSelected && <span className="text-xs text-accent-blue shrink-0">Selected</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {targetProject && (
        <div className="bg-[#162032] rounded-xl p-3 border border-[#253347]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-300">📊 {targetProject.projectName} Member Stats</p>
            {loading
              ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
              : <span className="text-xs text-gray-500">Total {total}</span>}
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
            <p className="text-xs text-gray-500 text-center py-3">No member data available.</p>
          )}
        </div>
      )}

      {!targetProject && (
        <p className="text-xs text-gray-500 text-center py-4">
          Select a project above<br />to view member statistics.
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────
// Message bubble
// ────────────────────────────────────────────────────
const INTENT_BADGE = {
  rag_db:      { label: 'Data Query',     color: 'text-green-400 bg-green-900/40 border-green-800/50'     },
  bim_builder: { label: 'BIM Operation', color: 'text-blue-400 bg-blue-900/40 border-blue-800/50'       },
  bim_query:   { label: 'BIM Query',     color: 'text-cyan-400 bg-cyan-900/40 border-cyan-800/50'        },
  vision:      { label: 'Image Analysis', color: 'text-purple-400 bg-purple-900/40 border-purple-800/50' },
  chat: null,
};

function AgentMessageBubble({ msg }) {
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
          {msg.content}
        </div>

        {/* Sensor data inline chart */}
        {!isUser && msg.intent === 'rag_db' && msg.sensorData && (
          <SensorInlineChart sensorData={msg.sensorData} />
        )}

        {/* BIM query inline summary */}
        {!isUser && msg.intent === 'bim_query' && msg.bimData && (
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
          <p className="text-xs font-semibold text-gray-400 mb-2">🌡 Temp/Humidity History ({sensorRows.length} records)</p>
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
            <span className="text-xs font-semibold text-gray-300">🏗 BIM Projects ({projects.length})</span>
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
              <div className="px-3 py-1.5 text-xs text-gray-500 text-center">...and {projects.length - 5} more</div>
            )}
          </div>
        </div>
      )}

      {stats && stats.length > 0 && (
        <div className="bg-[#162032] rounded-xl border border-[#253347] overflow-hidden">
          <div className="px-3 py-2 border-b border-[#253347]">
            <span className="text-xs font-semibold text-gray-300">📊 Member Stats — Total {total || 0}</span>
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
  return (
    <div className="flex justify-start">
      <div className="bg-[#253347] rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1.5 items-center">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
        <span className="text-xs text-gray-500 ml-1">AI processing...</span>
      </div>
    </div>
  );
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

const QUICK_PROMPTS = [
  'Show temperature graph', 'My BIM project list', 'Tell me the member count', 'Add column',
];
