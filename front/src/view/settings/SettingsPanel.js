import { useEffect, useState, useCallback, useRef } from 'react';
import AxiosCustom from '../../axios/AxiosCustom';
import { useT } from '../../i18n/LanguageContext';

const RETENTION_KEYS = ['1', '7', '30', '90', '0'];

function Section({ title, children }) {
  return (
    <div style={{
      background: '#0a1525', border: '1px solid #1e3a5f',
      borderRadius: 12, padding: '20px 24px', marginBottom: 16,
    }}>
      <h3 style={{ color: '#93c5fd', fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, desc, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      paddingBottom: 14, borderBottom: '1px solid #1a2a3a', marginBottom: 14,
      gap: 16, flexWrap: 'wrap',
    }}>
      <div>
        <p style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, margin: 0 }}>{label}</p>
        {desc && <p style={{ color: '#6b7280', fontSize: 11, marginTop: 3 }}>{desc}</p>}
      </div>
      {children}
    </div>
  );
}

// ── 리소스 게이지 바 ────────────────────────────────────────────────────────
function GaugeBar({ percent, color }) {
  const clampedPct = Math.min(100, Math.max(0, percent ?? 0));
  const barColor = percent >= 90 ? '#ef4444' : percent >= 70 ? '#f59e0b' : (color || '#3b82f6');
  return (
    <div style={{ background: '#0d1b2a', borderRadius: 4, height: 8, width: '100%', overflow: 'hidden' }}>
      <div style={{
        width: `${clampedPct}%`, height: '100%', borderRadius: 4,
        background: barColor, transition: 'width 0.4s ease',
      }} />
    </div>
  );
}

function fmtBytes(bytes) {
  if (bytes == null || bytes < 0) return '—';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576)    return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function fmtBps(bytes) {
  if (bytes == null || bytes < 0) return '—';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB/s';
  if (bytes >= 1024)    return (bytes / 1024).toFixed(1) + ' KB/s';
  return bytes + ' B/s';
}

function useTimeAgo() {
  const ts = useT('settings');
  return (timestamp) => {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60)   return ts('secAgo', { n: diff });
    if (diff < 3600) return ts('minAgo', { n: Math.floor(diff / 60) });
    return ts('hourAgo', { n: Math.floor(diff / 3600) });
  };
}

// ── 서버 모니터링 섹션 ──────────────────────────────────────────────────────
function ServerMonitor() {
  const ts = useT('settings');
  const timeAgo = useTimeAgo();
  const [stats, setStats]       = useState(null);
  const [visitors, setVisitors] = useState([]);
  const [netPrev, setNetPrev]   = useState(null);
  const [netRate, setNetRate]   = useState([]);
  const [lastTs, setLastTs]     = useState(null);
  const [error, setError]       = useState(null);
  const [tab, setTab]           = useState('resource'); // 'resource' | 'traffic' | 'visitors'

  const fetchAll = useCallback(async () => {
    try {
      const [statsRes, visitorsRes] = await Promise.all([
        AxiosCustom.get('/api/system/stats'),
        AxiosCustom.get('/api/system/visitors'),
      ]);
      const now = Date.now();
      const newStats = statsRes.data;

      // 네트워크 속도 계산 (전회 데이터 대비 diff)
      if (netPrev && lastTs) {
        const elapsed = (now - lastTs) / 1000;
        const rates = (newStats.net || []).map(iface => {
          const prev = netPrev.find(p => p.interface === iface.interface);
          return {
            interface: iface.interface,
            rxBps: prev ? Math.max(0, (iface.rxBytes - prev.rxBytes) / elapsed) : 0,
            txBps: prev ? Math.max(0, (iface.txBytes - prev.txBytes) / elapsed) : 0,
            rxBytes: iface.rxBytes,
            txBytes: iface.txBytes,
          };
        });
        setNetRate(rates);
      }

      setNetPrev(newStats.net || []);
      setLastTs(now);
      setStats(newStats);
      setVisitors(visitorsRes.data || []);
      setError(null);
    } catch (e) {
      setError(ts('connFailed'));
    }
  }, [netPrev, lastTs]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const tabBtnStyle = (active) => ({
    padding: '5px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
    background: active ? '#1e3a5f' : 'transparent',
    color:      active ? '#60a5fa' : '#6b7280',
    border:     '1px solid ' + (active ? '#2a5080' : '#253347'),
  });

  const mem  = stats?.memory ?? {};
  const disk = stats?.disk   ?? {};
  const up   = stats?.uptime ?? {};

  return (
    <div>
      {/* 탭 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[
          { key: 'resource', labelKey: 'tabResource' },
          { key: 'traffic',  labelKey: 'tabTraffic' },
          { key: 'visitors', labelKey: 'tabVisitors' },
        ].map(({ key, labelKey }) => (
          <button key={key} style={tabBtnStyle(tab === key)} onClick={() => setTab(key)}>{ts(labelKey)}</button>
        ))}
        <button onClick={fetchAll}
          style={{ marginLeft: 'auto', padding: '5px 10px', borderRadius: 6, fontSize: 11,
            background: 'transparent', color: '#4b5563', border: '1px solid #1a2a3a', cursor: 'pointer' }}>
          {ts('refresh')}
        </button>
      </div>

      {error && (
        <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>⚠ {error}</div>
      )}

      {/* ── 리소스 탭 ── */}
      {tab === 'resource' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 업타임 */}
          {up.totalSeconds != null && (
            <div style={{ fontSize: 11, color: '#4b5563' }}>
              {ts('uptimeLabel', { d: up.days, h: up.hours, m: up.minutes })}
            </div>
          )}

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{ts('memoryLabel')}</span>
              {mem.totalBytes > 0
                ? <span style={{ color: '#93c5fd' }}>
                    {fmtBytes(mem.usedBytes)} / {fmtBytes(mem.totalBytes)}
                    <span style={{ color: mem.usedPercent >= 80 ? '#ef4444' : '#4ade80', marginLeft: 8 }}>
                      {mem.usedPercent}%
                    </span>
                  </span>
                : <span style={{ color: '#4b5563' }}>{ts('collecting')}</span>
              }
            </div>
            <GaugeBar percent={mem.usedPercent} />
            {mem.availableBytes > 0 && (
              <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>
                {ts('freeLabel', { v: fmtBytes(mem.availableBytes) })}
              </div>
            )}
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{ts('diskLabel')}</span>
              {disk.totalBytes > 0
                ? <span style={{ color: '#93c5fd' }}>
                    {fmtBytes(disk.usedBytes)} / {fmtBytes(disk.totalBytes)}
                    <span style={{ color: disk.usedPercent >= 80 ? '#ef4444' : '#4ade80', marginLeft: 8 }}>
                      {disk.usedPercent}%
                    </span>
                  </span>
                : <span style={{ color: '#4b5563' }}>{ts('collecting')}</span>
              }
            </div>
            <GaugeBar percent={disk.usedPercent} color="#8b5cf6" />
            {disk.freeBytes > 0 && (
              <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>
                {ts('freeLabel', { v: fmtBytes(disk.freeBytes) })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 트래픽 탭 ── */}
      {tab === 'traffic' && (
        <div>
          {(netRate.length > 0 ? netRate : (stats?.net ?? [])).map(iface => (
            <div key={iface.interface} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: '#93c5fd', fontWeight: 600, marginBottom: 8 }}>
                {iface.interface}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ background: '#0d1b2a', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 4 }}>{ts('rxLabel')}</div>
                  <div style={{ fontSize: 14, color: '#4ade80', fontWeight: 700 }}>
                    {iface.rxBps != null ? fmtBps(iface.rxBps) : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>
                    {ts('cumulative', { v: fmtBytes(iface.rxBytes) })}
                  </div>
                </div>
                <div style={{ background: '#0d1b2a', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 4 }}>{ts('txLabel')}</div>
                  <div style={{ fontSize: 14, color: '#f59e0b', fontWeight: 700 }}>
                    {iface.txBps != null ? fmtBps(iface.txBps) : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>
                    {ts('cumulative', { v: fmtBytes(iface.txBytes) })}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {(stats?.net ?? []).length === 0 && !error && (
            <div style={{ fontSize: 12, color: '#4b5563' }}>{ts('noNetIface')}</div>
          )}
          <div style={{ fontSize: 10, color: '#374151', marginTop: 8 }}>
            {ts('trafficNote')}
          </div>
        </div>
      )}

      {/* ── 접속자 탭 ── */}
      {tab === 'visitors' && (
        <div>
          {visitors.length === 0
            ? <div style={{ fontSize: 12, color: '#4b5563' }}>{ts('noVisitors')}</div>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: '#4b5563', borderBottom: '1px solid #1a2a3a' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>{ts('colIp')}</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>{ts('colRequests')}</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>{ts('colLastUri')}</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>{ts('colLastAccess')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...visitors]
                      .sort((a, b) => b.lastTime - a.lastTime)
                      .map((v, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #111827' }}>
                          <td style={{ padding: '6px 8px', color: '#60a5fa', fontFamily: 'monospace' }}>
                            {v.ip}
                          </td>
                          <td style={{ padding: '6px 8px', color: '#93c5fd', textAlign: 'right' }}>
                            {v.count}
                          </td>
                          <td style={{ padding: '6px 8px', color: '#6b7280',
                            maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{
                              color: v.lastStatus >= 400 ? '#ef4444' : '#6b7280',
                              marginRight: 4, fontSize: 10
                            }}>{v.lastStatus}</span>
                            {v.lastUri}
                          </td>
                          <td style={{ padding: '6px 8px', color: '#4b5563', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {timeAgo(v.lastTime)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      )}
    </div>
  );
}

// ── RAG 인덱스 관리 ─────────────────────────────────────────────────────────
function RagManager() {
  const t = useT('settings');
  const [status, setStatus]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [building, setBuilding] = useState(false);
  const [msg, setMsg]           = useState('');

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const r = await AxiosCustom.get('/api/chat/rag-status');
      setStatus(r.data);
      if (r.data?.status === 'running') {
        setTimeout(fetchStatus, 3000);
      } else {
        setBuilding(false);
      }
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleRebuild = async () => {
    setBuilding(true);
    setMsg('');
    try {
      const r = await AxiosCustom.post('/api/chat/rag-rebuild');
      setMsg(r.data?.message || '');
      setTimeout(fetchStatus, 3000);
    } catch {
      setMsg(t('ragConnFailed'));
      setBuilding(false);
    }
  };

  const isRunning = building || status?.status === 'running';

  const statusColor = !status ? '#4b5563'
    : !status.dbReachable ? '#ef4444'
    : status.hasData ? '#4ade80'
    : '#f59e0b';

  const statusText = !status ? t('ragChecking')
    : !status.dbReachable ? t('ragDbFail')
    : status.status === 'running' ? t('ragIndexing')
    : status.hasData ? t('ragOk', { n: status.chunks?.toLocaleString() })
    : t('ragEmpty');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>{t('ragCollection')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%',
              background: statusColor, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: statusColor }}>{statusText}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={fetchStatus} disabled={loading}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              background: 'transparent', border: '1px solid #253347', color: '#6b7280' }}>
            ↻
          </button>
          <button onClick={handleRebuild} disabled={isRunning}
            style={{
              fontSize: 11, padding: '4px 14px', borderRadius: 6,
              cursor: isRunning ? 'wait' : 'pointer',
              background: isRunning ? '#1a2a3a' : '#1e3a5f',
              border: `1px solid ${isRunning ? '#253347' : '#2a5080'}`,
              color: isRunning ? '#6b7280' : '#60a5fa',
            }}>
            {isRunning ? t('ragBuilding') : t('ragRebuildBtn')}
          </button>
        </div>
      </div>
      {msg && (
        <div style={{ fontSize: 11, color: '#93c5fd', background: '#0d1b2a',
          border: '1px solid #1e3a5f', borderRadius: 6, padding: '6px 10px', marginTop: 4 }}>
          {msg}
        </div>
      )}
      <div style={{ fontSize: 10, color: '#374151', marginTop: 8 }}>
        {t('ragRebuildMsg')}
      </div>
    </div>
  );
}

// ── 메인 패널 ───────────────────────────────────────────────────────────────
export default function SettingsPanel() {
  const t = useT('settings');

  const [settings, setSettings]       = useState({});
  const [saving, setSaving]           = useState({});
  const [weatherLat, setWeatherLat]   = useState('37.5665');
  const [weatherLon, setWeatherLon]   = useState('126.9780');
  const [weatherCity, setWeatherCity] = useState('');
  const [retention, setRetention]     = useState('30');
  const [toast, setToast]             = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState('checking'); // 'checking' | 'ok' | 'mock' | 'error'

  const load = useCallback(() => {
    AxiosCustom.get('/api/settings').then(r => {
      const map = {};
      (r.data || []).forEach(s => { map[s.settingKey] = s.settingValue; });
      setSettings(map);
      if (map.chat_history_retention_days !== undefined) setRetention(map.chat_history_retention_days);
      if (map.weather_lat)  setWeatherLat(map.weather_lat);
      if (map.weather_lon)  setWeatherLon(map.weather_lon);
      if (map.weather_city) setWeatherCity(map.weather_city);
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  // API 키 등록 여부 확인
  useEffect(() => {
    setApiKeyStatus('checking');
    AxiosCustom.get('/api/weather?city=Seoul')
      .then(r => {
        const d = r.data;
        if (!d || d.error || typeof d.temp !== 'number') setApiKeyStatus('error');
        else if (d.mock) setApiKeyStatus('mock');
        else setApiKeyStatus('ok');
      })
      .catch(() => setApiKeyStatus('error'));
  }, []);

  const save = useCallback(async (key, value) => {
    setSaving(p => ({ ...p, [key]: true }));
    try {
      await AxiosCustom.put(`/api/settings/${key}`, { value });
      setSettings(p => ({ ...p, [key]: value }));
      setToast(t('saved'));
      setTimeout(() => setToast(''), 1800);
    } finally {
      setSaving(p => ({ ...p, [key]: false }));
    }
  }, [t]);

  const saveAll = useCallback(async () => {
    await Promise.all([
      save('chat_history_retention_days', retention),
      save('weather_lat',  weatherLat),
      save('weather_lon',  weatherLon),
      save('weather_city', weatherCity),
    ]);
  }, [save, retention, weatherLat, weatherLon, weatherCity]);

  const RETENTION_OPTIONS = [
    { value: '1',  label: t('day1') },
    { value: '7',  label: t('day7') },
    { value: '30', label: t('day30') },
    { value: '90', label: t('day90') },
    { value: '0',  label: t('unlimited') },
  ];

  const API_KEY_INFO = {
    checking: { color: '#6b7280', text: t('apiKeyChecking') },
    ok:       { color: '#4ade80', text: t('apiKeyOk') },
    mock:     { color: '#f59e0b', text: t('apiKeyMock') },
    error:    { color: '#f87171', text: t('apiKeyError') },
  };

  const btnStyle = (active) => ({
    padding: '4px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
    background: active ? '#1e3a5f' : 'transparent',
    color:      active ? '#60a5fa' : '#6b7280',
    border:     '1px solid ' + (active ? '#2a5080' : '#253347'),
    transition: 'all 0.15s',
  });

  const inputStyle = {
    background: '#0d1b2a', border: '1px solid #253347', borderRadius: 6,
    color: '#e2e8f0', fontSize: 12, padding: '5px 10px', width: 120,
  };

  const apiInfo = API_KEY_INFO[apiKeyStatus] ?? API_KEY_INFO.checking;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
        {t('title')}
      </h2>

      {/* ── RAG 인덱스 관리 ── */}
      <Section title={t('ragSection')}>
        <RagManager />
      </Section>

      {/* ── 서버 모니터링 ── */}
      <Section title={t('monitorSection')}>
        <ServerMonitor />
      </Section>

      {/* ── 대화 히스토리 정책 ── */}
      <Section title={t('chatSection')}>
        <Row label={t('retentionLabel')} desc={t('retentionDesc')}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {RETENTION_OPTIONS.map(({ value, label }) => (
              <button key={value}
                style={btnStyle(retention === value)}
                onClick={() => setRetention(value)}>
                {label}
              </button>
            ))}
          </div>
        </Row>
        <p style={{ fontSize: 11, color: '#4b5563', marginTop: -8 }}>
          {t('retentionCurrent')}{' '}
          <span style={{ color: '#60a5fa' }}>
            {RETENTION_OPTIONS.find(o => o.value === retention)?.label ?? retention}
          </span>
          {' '}{t('retentionSuffix')}
        </p>
      </Section>

      {/* ── 날씨 API 설정 ── */}
      <Section title={t('weatherSection')}>
        <Row label={t('cityLabel')} desc={t('cityDesc')}>
          <input style={inputStyle} value={weatherCity}
            placeholder={t('cityPlaceholder')}
            onChange={e => setWeatherCity(e.target.value)} />
        </Row>
        <Row label={t('latLonLabel')} desc={t('latLonDesc')}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={inputStyle} value={weatherLat}
              placeholder="lat"
              onChange={e => setWeatherLat(e.target.value)} />
            <input style={inputStyle} value={weatherLon}
              placeholder="lon"
              onChange={e => setWeatherLon(e.target.value)} />
          </div>
        </Row>

        {/* API 키 상태 표시 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', borderRadius: 8,
          background: '#060f1a', border: `1px solid ${apiInfo.color}30`,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', whiteSpace: 'nowrap' }}>
            {t('apiKeySection')}
          </span>
          <span style={{
            fontSize: 12, color: apiInfo.color,
            animation: apiKeyStatus === 'checking' ? 'pulse 1.4s ease-in-out infinite' : 'none',
          }}>
            {apiInfo.text}
          </span>
        </div>
        <p style={{ fontSize: 10, color: '#374151', marginTop: 8 }}>
          <code style={{ color: '#4b5563' }}>OPENWEATHER_API_KEY</code>
        </p>
      </Section>

      {/* ── 시스템 정보 ── */}
      <Section title={t('systemSection')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', fontSize: 12 }}>
          {[
            ['Platform', 'Digital Twin'],
            ['AI Model', 'qwen2.5:3b (Ollama)'],
            ['Router', 'llama3.2:1b'],
            ['Vector DB', 'pgvector (PostgreSQL)'],
            ['Standard', 'KCS / KDS'],
            ['Framework', 'Spring Boot 3 · React 19 · LangGraph'],
          ].map(([k, v]) => (
            <div key={k}>
              <span style={{ color: '#6b7280' }}>{k}: </span>
              <span style={{ color: '#93c5fd' }}>{v}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── 저장 버튼 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={saveAll}
          style={{
            padding: '8px 24px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: '#1e3a5f', border: '1px solid #2a5080', color: '#60a5fa',
            cursor: 'pointer',
          }}>
          {t('saveBtn')}
        </button>
        {toast && <span style={{ fontSize: 12, color: '#4ade80' }}>✓ {toast}</span>}
      </div>
    </div>
  );
}
