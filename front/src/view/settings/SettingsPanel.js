import { useEffect, useState, useCallback, useRef } from 'react';
import AxiosCustom from '../../axios/AxiosCustom';

const RETENTION_OPTIONS = [
  { value: '1',  label: '1일' },
  { value: '7',  label: '7일' },
  { value: '30', label: '30일' },
  { value: '90', label: '90일' },
  { value: '0',  label: '무제한' },
];

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

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)   return diff + '초 전';
  if (diff < 3600) return Math.floor(diff / 60) + '분 전';
  return Math.floor(diff / 3600) + '시간 전';
}

// ── 서버 모니터링 섹션 ──────────────────────────────────────────────────────
function ServerMonitor() {
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
      setError('서버 연결 실패');
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
          { key: 'resource', label: '💾 리소스' },
          { key: 'traffic',  label: '📡 트래픽' },
          { key: 'visitors', label: '👥 접속자' },
        ].map(({ key, label }) => (
          <button key={key} style={tabBtnStyle(tab === key)} onClick={() => setTab(key)}>{label}</button>
        ))}
        <button onClick={fetchAll}
          style={{ marginLeft: 'auto', padding: '5px 10px', borderRadius: 6, fontSize: 11,
            background: 'transparent', color: '#4b5563', border: '1px solid #1a2a3a', cursor: 'pointer' }}>
          ↻ 새로고침
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
              호스트 업타임: <span style={{ color: '#93c5fd' }}>{up.days}일 {up.hours}시간 {up.minutes}분</span>
            </div>
          )}

          {/* 메모리 */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: '#e2e8f0', fontWeight: 600 }}>메모리</span>
              {mem.totalBytes > 0
                ? <span style={{ color: '#93c5fd' }}>
                    {fmtBytes(mem.usedBytes)} / {fmtBytes(mem.totalBytes)}
                    <span style={{ color: mem.usedPercent >= 80 ? '#ef4444' : '#4ade80', marginLeft: 8 }}>
                      {mem.usedPercent}%
                    </span>
                  </span>
                : <span style={{ color: '#4b5563' }}>수집 중…</span>
              }
            </div>
            <GaugeBar percent={mem.usedPercent} />
            {mem.availableBytes > 0 && (
              <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>
                여유: {fmtBytes(mem.availableBytes)}
              </div>
            )}
          </div>

          {/* 디스크 */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: '#e2e8f0', fontWeight: 600 }}>디스크</span>
              {disk.totalBytes > 0
                ? <span style={{ color: '#93c5fd' }}>
                    {fmtBytes(disk.usedBytes)} / {fmtBytes(disk.totalBytes)}
                    <span style={{ color: disk.usedPercent >= 80 ? '#ef4444' : '#4ade80', marginLeft: 8 }}>
                      {disk.usedPercent}%
                    </span>
                  </span>
                : <span style={{ color: '#4b5563' }}>수집 중…</span>
              }
            </div>
            <GaugeBar percent={disk.usedPercent} color="#8b5cf6" />
            {disk.freeBytes > 0 && (
              <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>
                여유: {fmtBytes(disk.freeBytes)}
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
                  <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 4 }}>↓ 수신 (RX)</div>
                  <div style={{ fontSize: 14, color: '#4ade80', fontWeight: 700 }}>
                    {iface.rxBps != null ? fmtBps(iface.rxBps) : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>
                    누적 {fmtBytes(iface.rxBytes)}
                  </div>
                </div>
                <div style={{ background: '#0d1b2a', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 4 }}>↑ 송신 (TX)</div>
                  <div style={{ fontSize: 14, color: '#f59e0b', fontWeight: 700 }}>
                    {iface.txBps != null ? fmtBps(iface.txBps) : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>
                    누적 {fmtBytes(iface.txBytes)}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {(stats?.net ?? []).length === 0 && !error && (
            <div style={{ fontSize: 12, color: '#4b5563' }}>네트워크 인터페이스 정보 없음 (호스트 마운트 필요)</div>
          )}
          <div style={{ fontSize: 10, color: '#374151', marginTop: 8 }}>
            * 속도는 5초 간격 샘플링 값입니다
          </div>
        </div>
      )}

      {/* ── 접속자 탭 ── */}
      {tab === 'visitors' && (
        <div>
          {visitors.length === 0
            ? <div style={{ fontSize: 12, color: '#4b5563' }}>접속 기록 없음</div>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: '#4b5563', borderBottom: '1px solid #1a2a3a' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>실IP</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>요청수</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>마지막 URI</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>마지막 접속</th>
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

// ── 메인 패널 ───────────────────────────────────────────────────────────────
export default function SettingsPanel() {
  const [settings, setSettings]       = useState({});
  const [saving, setSaving]           = useState({});
  const [weatherLat, setWeatherLat]   = useState('37.5665');
  const [weatherLon, setWeatherLon]   = useState('126.9780');
  const [weatherCity, setWeatherCity] = useState('');
  const [retention, setRetention]     = useState('30');
  const [toast, setToast]             = useState('');

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

  const save = useCallback(async (key, value) => {
    setSaving(p => ({ ...p, [key]: true }));
    try {
      await AxiosCustom.put(`/api/settings/${key}`, { value });
      setSettings(p => ({ ...p, [key]: value }));
      setToast('저장됨');
      setTimeout(() => setToast(''), 1800);
    } finally {
      setSaving(p => ({ ...p, [key]: false }));
    }
  }, []);

  const saveAll = useCallback(async () => {
    await Promise.all([
      save('chat_history_retention_days', retention),
      save('weather_lat',  weatherLat),
      save('weather_lon',  weatherLon),
      save('weather_city', weatherCity),
    ]);
  }, [save, retention, weatherLat, weatherLon, weatherCity]);

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

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
        ⚙️ 환경 설정
      </h2>

      {/* ── 서버 모니터링 ── */}
      <Section title="🖥️ 서버 모니터링 (호스트)">
        <ServerMonitor />
      </Section>

      {/* ── 대화 히스토리 정책 ── */}
      <Section title="💬 대화 히스토리 보관 정책">
        <Row label="보관 기간"
             desc="설정 기간이 지난 대화 기록은 매일 새벽 3시에 자동 삭제됩니다. (0 = 무제한 보존)">
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
          현재 설정: <span style={{ color: '#60a5fa' }}>
            {RETENTION_OPTIONS.find(o => o.value === retention)?.label ?? retention + '일'}
          </span>
          {' '}보관 · 저장 후 다음날 새벽 3시부터 적용
        </p>
      </Section>

      {/* ── 날씨 API 설정 ── */}
      <Section title="🌤️ 날씨 위젯 위치 설정">
        <Row label="도시명 (우선)"
             desc="입력 시 좌표보다 우선 사용됩니다. 예: Seoul, Busan">
          <input style={inputStyle} value={weatherCity}
            placeholder="예: Seoul"
            onChange={e => setWeatherCity(e.target.value)} />
        </Row>
        <Row label="위도 / 경도"
             desc="도시명이 비어있을 때 사용됩니다.">
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={inputStyle} value={weatherLat}
              placeholder="위도 (lat)"
              onChange={e => setWeatherLat(e.target.value)} />
            <input style={inputStyle} value={weatherLon}
              placeholder="경도 (lon)"
              onChange={e => setWeatherLon(e.target.value)} />
          </div>
        </Row>
        <p style={{ fontSize: 11, color: '#4b5563' }}>
          OpenWeatherMap API 키는 서버 환경변수 <code style={{ color: '#60a5fa' }}>OPENWEATHER_API_KEY</code> 에 설정하세요.
          키가 없으면 데모 데이터가 표시됩니다.
        </p>
      </Section>

      {/* ── 시스템 정보 ── */}
      <Section title="ℹ️ 시스템 정보">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', fontSize: 12 }}>
          {[
            ['플랫폼', 'Digital Twin YJ-01'],
            ['AI 모델', 'qwen2.5:3b (Ollama)'],
            ['라우터 모델', 'llama3.2:1b'],
            ['벡터 DB', 'pgvector (PostgreSQL)'],
            ['건설 기준', 'KCS / KDS 한국 시방서'],
            ['프레임워크', 'Spring Boot 3 · React 19 · LangGraph'],
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
          💾 설정 저장
        </button>
        {toast && <span style={{ fontSize: 12, color: '#4ade80' }}>✓ {toast}</span>}
      </div>
    </div>
  );
}
