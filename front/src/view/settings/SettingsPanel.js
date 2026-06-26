import { useEffect, useState, useCallback, useRef } from 'react';
import AxiosCustom from '../../axios/AxiosCustom';
import { useT } from '../../i18n/LanguageContext';
import WorldAccessMap from './WorldAccessMap';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

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

// ── 차트 공통 ───────────────────────────────────────────────────────────────
const CHART_THEME = {
  bg:     '#060e1a',
  grid:   '#1a2a3a',
  tick:   '#374151',
  tip:    { bg: '#0a1525', border: '#1e3a5f', text: '#e2e8f0' },
};

function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function fmtMB(bytes) { return +(bytes / 1024 / 1024).toFixed(2); }

function ChartCard({ title, badge, children }) {
  return (
    <div style={{
      background: CHART_THEME.bg, border: '1px solid #1e3a5f',
      borderRadius: 10, padding: '14px 8px 8px', marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12, marginBottom: 10 }}>
        <span style={{ color: '#93c5fd', fontSize: 12, fontWeight: 700 }}>{title}</span>
        {badge && <span style={{ fontSize: 10, color: '#4b5563' }}>{badge}</span>}
      </div>
      {children}
    </div>
  );
}

function EmptyChart() {
  const t = useT('settings');
  return (
    <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 11, color: '#374151' }}>{t('nginxEmptyChart')}</span>
    </div>
  );
}

const CustomTooltipStyle = {
  background: '#0a1525', border: '1px solid #1e3a5f', borderRadius: 6,
  padding: '6px 10px', fontSize: 11, color: '#e2e8f0',
};

function fmtHourLabel(ts) {
  const d = new Date(ts);
  return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:00`;
}

// nginx access.log 파싱 결과를 시각화하는 섹션
function NginxAccessSection({ nginxLog }) {
  const t = useT('settings');
  if (!nginxLog) return null;

  // 로그 파일 없음: 설치 안내
  if (!nginxLog.available) {
    return (
      <div style={{
        background: '#060e1a', border: '1px solid #1e3a5f',
        borderRadius: 10, padding: '14px 16px', marginBottom: 14,
      }}>
        <div style={{ color: '#93c5fd', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
          {t('nginxSection')}
        </div>
        <div style={{ fontSize: 11, color: '#4b5563', lineHeight: 1.8 }}>
          <div style={{ color: '#f59e0b', marginBottom: 6 }}>⚠ {nginxLog.reason}</div>
          <div style={{ color: '#374151', fontFamily: 'monospace', fontSize: 10, background: '#0a1525',
            padding: '10px 12px', borderRadius: 6, border: '1px solid #1a2a3a' }}>
            {t('nginxK8sGuide')}
            {'\n'}
            {'volumes:'}
            {'\n'}
            {'  - name: nginx-logs'}
            {'\n'}
            {'    hostPath: { path: /var/log/nginx }'}
            {'\n'}
            {'volumeMounts:'}
            {'\n'}
            {'  - name: nginx-logs'}
            {'\n'}
            {'    mountPath: /host/nginx-logs'}
            {'\n'}
            {'    readOnly: true'}
          </div>
          <div style={{ marginTop: 6, color: '#374151', fontSize: 10 }}>
            {t('nginxEnvVarOr')} <code style={{ color: '#60a5fa' }}>NGINX_ACCESS_LOG=/var/log/nginx/access.log</code>
          </div>
        </div>
      </div>
    );
  }

  // 시간별 데이터
  const hourlyData = (nginxLog.hourly || []).map(h => ({
    ts:        h.timestamp,
    hour:      h.hour,
    requests:  h.requests,
    uniqueIps: h.uniqueIps,
  }));

  // 최근 48개만 표시 (48h)
  const chartData = hourlyData.slice(-48);
  const totalReq  = hourlyData.reduce((s, h) => s + h.requests, 0);
  const topIps    = (nginxLog.topIps || []).slice(0, 10);

  return (
    <div style={{
      background: '#060e1a', border: '1px solid #1e3a5f',
      borderRadius: 10, padding: '14px 16px', marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color: '#93c5fd', fontSize: 12, fontWeight: 700 }}>{t('nginxSectionAvailable')}</span>
        <span style={{ fontSize: 10, color: '#4b5563' }}>
          {t('nginxParsedStats', { path: nginxLog.logPath, lines: (nginxLog.parsedLines || 0).toLocaleString(), req: totalReq.toLocaleString() })}
        </span>
      </div>

      {/* 시간별 요청 수 (BarChart) */}
      {chartData.length === 0
        ? <div style={{ height: 100, display:'flex', alignItems:'center', justifyContent:'center',
            fontSize: 11, color: '#374151' }}>{t('nginxLogEmpty')}</div>
        : (
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={chartData} margin={{ top: 0, right: 16, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis dataKey="ts" tickFormatter={fmtHourLabel}
                tick={{ fill: CHART_THEME.tick, fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: CHART_THEME.tick, fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                labelFormatter={fmtHourLabel}
                contentStyle={CustomTooltipStyle}
                formatter={(v, name) => [
                  v,
                  name === 'requests' ? t('nginxRequests') : t('nginxUniqueIp'),
                ]}
              />
              <Legend formatter={(v) => v === 'requests' ? t('nginxRequests') : t('nginxUniqueIp')}
                wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
              <Bar dataKey="requests"  fill="#38bdf8" maxBarSize={20} />
              <Bar dataKey="uniqueIps" fill="#818cf8" maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        )
      }

      {/* 상위 IP 목록 */}
      {topIps.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: '#4b5563', marginBottom: 6 }}>{t('nginxTopIp')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {topIps.map((ip, i) => (
              <span key={i} style={{
                fontSize: 10, background: '#0a1525', border: '1px solid #1a2a3a',
                borderRadius: 5, padding: '2px 8px',
              }}>
                <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>{ip.ip}</span>
                <span style={{ color: '#374151', marginLeft: 4 }}>×{ip.count.toLocaleString()}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 서버 모니터링 섹션 ──────────────────────────────────────────────────────
function ServerMonitor() {
  const ts       = useT('settings');
  const timeAgo  = useTimeAgo();

  const [stats,    setStats]    = useState(null);
  const [visitors, setVisitors] = useState([]);
  const [history,  setHistory]  = useState([]);
  const [nginxLog, setNginxLog] = useState(null);
  const [error,    setError]    = useState(null);

  // 현재 상태 (5초 폴링)
  const fetchCurrent = useCallback(async () => {
    try {
      const [sRes, vRes] = await Promise.all([
        AxiosCustom.get('/api/system/stats'),
        AxiosCustom.get('/api/system/visitors'),
      ]);
      setStats(sRes.data);
      setVisitors(vRes.data || []);
      setError(null);
    } catch { setError(ts('connFailed')); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchCurrent();
    const id = setInterval(fetchCurrent, 5000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 히스토리 (30초 폴링)
  const fetchHistory = useCallback(async () => {
    try {
      const res = await AxiosCustom.get('/api/system/history');
      setHistory(res.data || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchHistory();
    const id = setInterval(fetchHistory, 30000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // nginx 로그 (60초 폴링 — 로그는 1초 단위로 바뀌지 않음)
  const fetchNginxLog = useCallback(async () => {
    try {
      const res = await AxiosCustom.get('/api/system/nginx-log');
      setNginxLog(res.data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchNginxLog();
    const id = setInterval(fetchNginxLog, 60000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 차트 데이터 변환
  const chartData = history.map(h => ({
    time:     h.timestamp,
    visitors: h.requests,
    rx:       fmtMB(h.rxBytes),
    tx:       fmtMB(h.txBytes),
    disk:     h.diskUsedPct,
    diskUsed: fmtMB(h.diskUsed),
  }));

  const mem  = stats?.memory ?? {};
  const disk = stats?.disk   ?? {};
  const up   = stats?.uptime ?? {};

  return (
    <div>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        {up.totalSeconds != null && (
          <span style={{ fontSize: 11, color: '#374151' }}>
            {ts('uptimeLabel', { d: up.days, h: up.hours, m: up.minutes })}
          </span>
        )}
        <button onClick={() => { fetchCurrent(); fetchHistory(); fetchNginxLog(); }}
          style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, fontSize: 11,
            background: 'transparent', color: '#4b5563', border: '1px solid #1a2a3a', cursor: 'pointer' }}>
          {ts('refresh')}
        </button>
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>⚠ {error}</div>}

      {/* ── 1. 접속자 수 ── */}
      <ChartCard title={ts('monitorVisitors')} badge={ts('monitorVisitorBadge')}>
        {chartData.length === 0 ? <EmptyChart /> : (
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={chartData} margin={{ top: 0, right: 16, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis dataKey="time" tickFormatter={fmtTime} tick={{ fill: CHART_THEME.tick, fontSize: 10 }}
                interval="preserveStartEnd" />
              <YAxis tick={{ fill: CHART_THEME.tick, fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                labelFormatter={fmtTime}
                contentStyle={CustomTooltipStyle}
                formatter={(v) => [ts('monitorReqUnit', { n: v }), ts('monitorVisitors')]}
              />
              <Line type="monotone" dataKey="visitors" stroke="#60a5fa" strokeWidth={2}
                dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
        {/* 현재 접속자 요약 */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingLeft: 12, marginTop: 8 }}>
          {[...visitors].sort((a, b) => b.count - a.count).slice(0, 5).map((v, i) => (
            <span key={i} style={{
              fontSize: 10, color: '#6b7280', background: '#0d1b2a',
              borderRadius: 5, padding: '2px 7px', border: '1px solid #1a2a3a',
            }}>
              <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{v.ip}</span>
              <span style={{ color: '#374151', marginLeft: 4 }}>×{v.count}</span>
            </span>
          ))}
        </div>
      </ChartCard>

      {/* ── 2. 네트워크 트래픽 ── */}
      <ChartCard title={ts('monitorNetwork')} badge={ts('monitorNetworkBadge')}>
        {chartData.length === 0 ? <EmptyChart /> : (
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={chartData} margin={{ top: 0, right: 16, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis dataKey="time" tickFormatter={fmtTime} tick={{ fill: CHART_THEME.tick, fontSize: 10 }}
                interval="preserveStartEnd" />
              <YAxis tick={{ fill: CHART_THEME.tick, fontSize: 10 }} unit=" MB" />
              <Tooltip
                labelFormatter={fmtTime}
                contentStyle={CustomTooltipStyle}
                formatter={(v, name) => [`${v} MB`, name === 'rx' ? ts('monitorNetRx') : ts('monitorNetTx')]}
              />
              <Legend formatter={(v) => v === 'rx' ? ts('monitorNetRx') : ts('monitorNetTx')}
                wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
              <Line type="monotone" dataKey="rx" stroke="#4ade80" strokeWidth={2}
                dot={false} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="tx" stroke="#f59e0b" strokeWidth={2}
                dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* ── 3. 디스크 사용률 ── */}
      <ChartCard
        title={ts('monitorDisk')}
        badge={disk.totalBytes > 0
          ? `${ts('monitorDiskCurrent')} ${fmtBytes(disk.usedBytes)} / ${fmtBytes(disk.totalBytes)}  (${disk.usedPercent}%)`
          : undefined}
      >
        {chartData.length === 0 ? <EmptyChart /> : (
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={chartData} margin={{ top: 0, right: 16, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="diskGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis dataKey="time" tickFormatter={fmtTime} tick={{ fill: CHART_THEME.tick, fontSize: 10 }}
                interval="preserveStartEnd" />
              <YAxis tick={{ fill: CHART_THEME.tick, fontSize: 10 }} domain={[0, 100]} unit="%" />
              <Tooltip
                labelFormatter={fmtTime}
                contentStyle={CustomTooltipStyle}
                formatter={(v) => [`${v}%`, ts('monitorDiskLabel')]}
              />
              <Area type="monotone" dataKey="disk" stroke="#8b5cf6" strokeWidth={2}
                fill="url(#diskGrad)" dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
        {/* 현재 디스크 게이지 */}
        {disk.totalBytes > 0 && (
          <div style={{ paddingLeft: 12, paddingRight: 16, marginTop: 8 }}>
            <GaugeBar percent={disk.usedPercent} color="#8b5cf6" />
            {disk.freeBytes > 0 && (
              <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>
                {ts('freeLabel', { v: fmtBytes(disk.freeBytes) })}
              </div>
            )}
          </div>
        )}
      </ChartCard>

      {/* ── 메모리 현황 (소형) ── */}
      {mem.totalBytes > 0 && (
        <div style={{
          background: '#060e1a', border: '1px solid #1e3a5f',
          borderRadius: 10, padding: '12px 16px', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
            <span style={{ color: '#93c5fd', fontWeight: 700 }}>{ts('memoryLabel')}</span>
            <span style={{ color: '#93c5fd' }}>
              {fmtBytes(mem.usedBytes)} / {fmtBytes(mem.totalBytes)}
              <span style={{ color: mem.usedPercent >= 80 ? '#ef4444' : '#4ade80', marginLeft: 8 }}>
                {mem.usedPercent}%
              </span>
            </span>
          </div>
          <GaugeBar percent={mem.usedPercent} />
          {mem.availableBytes > 0 && (
            <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>
              {ts('freeLabel', { v: fmtBytes(mem.availableBytes) })}
            </div>
          )}
        </div>
      )}

      {/* ── 접속자 테이블 ── */}
      <div style={{
        background: '#060e1a', border: '1px solid #1e3a5f',
        borderRadius: 10, padding: '14px 16px', marginBottom: 14,
      }}>
        <div style={{ color: '#93c5fd', fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
          👥 {ts('tabVisitors')}
        </div>
        {visitors.length === 0
          ? <div style={{ fontSize: 12, color: '#4b5563' }}>{ts('noVisitors')}</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: '#4b5563', borderBottom: '1px solid #1a2a3a' }}>
                    <th style={{ textAlign: 'left',  padding: '5px 8px', fontWeight: 600 }}>{ts('colIp')}</th>
                    <th style={{ textAlign: 'right', padding: '5px 8px', fontWeight: 600 }}>{ts('colRequests')}</th>
                    <th style={{ textAlign: 'left',  padding: '5px 8px', fontWeight: 600 }}>{ts('colLastUri')}</th>
                    <th style={{ textAlign: 'right', padding: '5px 8px', fontWeight: 600 }}>{ts('colLastAccess')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...visitors].sort((a, b) => b.lastTime - a.lastTime).map((v, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #111827' }}>
                      <td style={{ padding: '5px 8px', color: '#60a5fa', fontFamily: 'monospace' }}>{v.ip}</td>
                      <td style={{ padding: '5px 8px', color: '#93c5fd', textAlign: 'right' }}>{v.count}</td>
                      <td style={{ padding: '5px 8px', color: '#6b7280',
                        maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ color: v.lastStatus >= 400 ? '#ef4444' : '#6b7280',
                          marginRight: 4, fontSize: 10 }}>{v.lastStatus}</span>
                        {v.lastUri}
                      </td>
                      <td style={{ padding: '5px 8px', color: '#4b5563', textAlign: 'right', whiteSpace: 'nowrap' }}>
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

      {/* ── nginx 서버 접속 기록 ── */}
      <NginxAccessSection nginxLog={nginxLog} />

      {/* ── 세계지도 ── */}
      <div style={{
        background: '#060e1a', border: '1px solid #1e3a5f',
        borderRadius: 10, padding: '14px 16px',
      }}>
        <div style={{ color: '#93c5fd', fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
          🌍 {ts('tabWorldMap')}
        </div>
        <WorldAccessMap />
      </div>
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

// ── GraphRAG 인덱스 관리 (Leiden 커뮤니티) ──────────────────────────────────
function GraphRagManager() {
  const t = useT('settings');
  const [status, setStatus]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [building, setBuilding] = useState(false);
  const [msg, setMsg]           = useState('');

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const r = await AxiosCustom.get('/api/chat/graph-rag-status');
      setStatus(r.data);
      if (r.data?.status === 'running') {
        setTimeout(fetchStatus, 5000);
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

  // 새로고침 = GraphRAG 인덱스 재구축 (엔티티 추출 + Leiden + 요약)
  const handleRebuild = async () => {
    setBuilding(true);
    setMsg('');
    try {
      const r = await AxiosCustom.post('/api/chat/graph-rag-rebuild');
      setMsg(r.data?.message || '');
      setTimeout(fetchStatus, 5000);
    } catch {
      setMsg(t('graphRagConnFailed'));
      setBuilding(false);
    }
  };

  const isRunning = building || status?.status === 'running';

  const statusColor = !status ? '#4b5563'
    : !status.dbReachable ? '#ef4444'
    : status.hasData ? '#a78bfa'
    : '#f59e0b';

  const statusText = !status ? t('graphRagChecking')
    : !status.dbReachable ? t('graphRagDbFail')
    : status.status === 'running' ? t('graphRagIndexing')
    : status.hasData ? t('graphRagOk', { n: status.communities?.toLocaleString() })
    : t('graphRagEmpty');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>{t('graphRagCollection')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%',
              background: statusColor, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: statusColor }}>{statusText}</span>
          </div>
        </div>
        {/* 새로고침 = 재구축 트리거 */}
        <button onClick={handleRebuild} disabled={isRunning}
          style={{
            fontSize: 11, padding: '4px 14px', borderRadius: 6,
            cursor: isRunning ? 'wait' : 'pointer',
            background: isRunning ? '#1a1a2e' : '#2d1b69',
            border: `1px solid ${isRunning ? '#2d2d4e' : '#5b21b6'}`,
            color: isRunning ? '#6b7280' : '#a78bfa',
          }}>
          {isRunning ? t('graphRagBuilding') : t('graphRagRebuildBtn')}
        </button>
      </div>
      {msg && (
        <div style={{ fontSize: 11, color: '#c4b5fd', background: '#0d0d1a',
          border: '1px solid #3b1f6e', borderRadius: 6, padding: '6px 10px', marginTop: 4 }}>
          {msg}
        </div>
      )}
      <div style={{ fontSize: 10, color: '#374151', marginTop: 8 }}>
        {t('graphRagRebuildMsg')}
      </div>
    </div>
  );
}

// ── 센서 임계값 편집 섹션 ───────────────────────────────────────────────────
function SensorThresholdSection() {
  const t = useT('settings');
  const FIELDS = [
    { key: 'temp_high', label: t('sensorTempHigh'), color: '#ef4444', min: 0,   max: 80 },
    { key: 'temp_low',  label: t('sensorTempLow'),  color: '#3b82f6', min: -30, max: 40 },
    { key: 'hum_high',  label: t('sensorHumHigh'),  color: '#f59e0b', min: 0,   max: 100 },
    { key: 'hum_low',   label: t('sensorHumLow'),   color: '#6366f1', min: 0,   max: 100 },
  ];

  const [values, setValues] = useState(null);   // null = 로딩 중
  const [draft,  setDraft]  = useState({});
  const [saving, setSaving] = useState(false);
  const [msg,    setMsg]    = useState('');

  const load = useCallback(async () => {
    try {
      const r = await AxiosCustom.get('/api/chat/sensor-thresholds');
      setValues(r.data);
      setDraft(r.data);
    } catch {
      setMsg(t('sensorConnFailed'));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      const r = await AxiosCustom.put('/api/chat/sensor-thresholds', draft);
      setValues(r.data);
      setDraft(r.data);
      setMsg(t('sensorSaved'));
      setTimeout(() => setMsg(''), 2000);
    } catch {
      setMsg(t('sensorSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = (changed) => ({
    background: '#0d1b2a',
    border: `1px solid ${changed ? '#60a5fa' : '#253347'}`,
    borderRadius: 6,
    color: '#e2e8f0',
    fontSize: 13,
    padding: '5px 10px',
    width: 90,
    textAlign: 'right',
  });

  if (values === null) {
    return <div style={{ color: '#4b5563', fontSize: 12 }}>
      {msg || t('sensorLoading')}
    </div>;
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 32px', marginBottom: 16 }}>
        {FIELDS.map(({ key, label, color, min, max }) => {
          const changed = draft[key] !== values[key];
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: 12, color, fontWeight: 600 }}>●</span>
                <span style={{ fontSize: 12, color: '#e2e8f0', marginLeft: 6 }}>{label}</span>
              </div>
              <input
                type="number"
                min={min}
                max={max}
                step={0.5}
                value={draft[key] ?? ''}
                onChange={e => setDraft(p => ({ ...p, [key]: parseFloat(e.target.value) }))}
                style={inputStyle(changed)}
              />
            </div>
          );
        })}
      </div>

      {/* 현재 값 vs 변경 값 미리보기 */}
      {FIELDS.some(f => draft[f.key] !== values[f.key]) && (
        <div style={{
          fontSize: 11, color: '#60a5fa', background: '#0d1b2a',
          border: '1px solid #1e3a5f', borderRadius: 6,
          padding: '6px 10px', marginBottom: 12,
        }}>
          {t('sensorPendingPrefix')} {FIELDS.filter(f => draft[f.key] !== values[f.key])
            .map(f => `${f.label} ${values[f.key]} → ${draft[f.key]}`).join(' / ')}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '5px 18px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: saving ? '#1a2a3a' : '#1e3a5f',
            border: `1px solid ${saving ? '#253347' : '#2a5080'}`,
            color: saving ? '#6b7280' : '#60a5fa',
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving ? t('sensorSaving') : t('sensorApply')}
        </button>
        <button
          onClick={load}
          style={{
            padding: '5px 12px', borderRadius: 6, fontSize: 12,
            background: 'transparent', border: '1px solid #253347', color: '#6b7280', cursor: 'pointer',
          }}
        >
          {t('sensorReset')}
        </button>
        {msg && (
          <span style={{ fontSize: 12, color: msg === t('sensorSaved') ? '#4ade80' : '#f87171' }}>
            {msg === t('sensorSaved') ? '✓ ' : '✗ '}{msg}
          </span>
        )}
      </div>
      <p style={{ fontSize: 10, color: '#374151', marginTop: 8 }}>
        {t('sensorResetNote')}
      </p>
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

      {/* ── 센서 알람 임계값 ── */}
      <Section title={t('sensorAlarmSection')}>
        <SensorThresholdSection />
      </Section>

      {/* ── RAG 인덱스 관리 ── */}
      <Section title={t('ragSection')}>
        <RagManager />
      </Section>

      {/* ── GraphRAG 인덱스 관리 ── */}
      <Section title={t('graphRagSection')}>
        <GraphRagManager />
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
