import { useEffect, useState, useCallback, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';
import AxiosCustom from '../axios/AxiosCustom';

// ── 유틸 ─────────────────────────────────────────────────────────

function buildWsUrl(path) {
  if (typeof window === 'undefined') return path;
  return `${window.location.protocol}//${window.location.host}${path}`;
}

function StatusBadge({ label, ok }) {
  return (
    <span style={{
      fontSize: 10, padding: '2px 7px', borderRadius: 10, fontWeight: 600,
      background: ok ? '#0d2211' : '#3a0f0f',
      border: `1px solid ${ok ? '#4ade80' : '#ef4444'}`,
      color: ok ? '#4ade80' : '#f87171',
    }}>
      {ok ? '✓' : '⚠'} {label}
    </span>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#0d1b2a', border: '1px solid #253347',
      borderRadius: 8, padding: '6px 12px', fontSize: 11,
    }}>
      <p style={{ color: '#8896a4', marginBottom: 4 }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color, margin: '2px 0' }}>
          {p.name}: <strong>{p.value}</strong>{p.dataKey.includes('temp') ? '°C' : '%'}
        </p>
      ))}
    </div>
  );
};

// ── 메인 컴포넌트 ─────────────────────────────────────────────────

export default function SensorPanel() {
  const [latest, setLatest]         = useState(null);
  const [trend, setTrend]           = useState([]);
  const [locations, setLocations]   = useState([]);
  const [selLocation, setSelLoc]    = useState('');   // '' = 전체
  const [thresholds, setThresholds] = useState({ tempMax: 35, tempMin: 0, humMax: 80, humMin: 20 });
  const [trendHours, setTrendHours] = useState(24);
  const [metric, setMetric]         = useState('both');
  const [wsStatus, setWsStatus]     = useState('disconnected');
  const stompRef = useRef(null);

  // ── 데이터 페치 ────────────────────────────────────────────────

  const fetchLatest = useCallback(() => {
    AxiosCustom.get('/api/sensor/latest')
      .then(r => { if (r.data?.temperature != null) setLatest(r.data); })
      .catch(() => {});
  }, []);

  const fetchTrend = useCallback(() => {
    const bucket = trendHours <= 6 ? '30 minutes' : trendHours <= 48 ? '1 hour' : '6 hours';
    const loc = selLocation ? `&location=${encodeURIComponent(selLocation)}` : '';
    AxiosCustom.get(`/api/sensor/trend?hours=${trendHours}&bucket=${encodeURIComponent(bucket)}${loc}`)
      .then(r => {
        const data = (r.data || []).map(d => ({
          time:     d.bucket
            ? new Date(d.bucket).toLocaleString('ko-KR', {
                month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
              })
            : '',
          avgTemp:  Number(Number(d.avg_temp  || 0).toFixed(1)),
          minTemp:  Number(Number(d.min_temp  || 0).toFixed(1)),
          maxTemp:  Number(Number(d.max_temp  || 0).toFixed(1)),
          avgHum:   Number(Number(d.avg_humidity || 0).toFixed(1)),
          location: d.location,
        }));
        setTrend(data);
      })
      .catch(() => setTrend([]));
  }, [trendHours, selLocation]);

  const fetchLocations = useCallback(() => {
    AxiosCustom.get('/api/sensor/locations')
      .then(r => setLocations(r.data || []))
      .catch(() => {});
  }, []);

  const fetchThresholds = useCallback(() => {
    AxiosCustom.get('/api/sensor/thresholds')
      .then(r => setThresholds(r.data))
      .catch(() => {});
  }, []);

  // ── 초기 로딩 ──────────────────────────────────────────────────

  useEffect(() => {
    fetchLatest();
    fetchTrend();
    fetchLocations();
    fetchThresholds();
    const latestTimer = setInterval(fetchLatest, 10_000);
    return () => clearInterval(latestTimer);
  }, [fetchLatest, fetchTrend, fetchLocations, fetchThresholds]);

  useEffect(() => {
    fetchTrend();
    const trendTimer = setInterval(fetchTrend, 60_000);
    return () => clearInterval(trendTimer);
  }, [fetchTrend]);

  // ── WebSocket 실시간 구독 ───────────────────────────────────────

  useEffect(() => {
    const client = new Client({
      webSocketFactory: () => new SockJS(buildWsUrl('/ws/sensor')),
      reconnectDelay: 5000,
      onConnect: () => {
        setWsStatus('connected');
        client.subscribe('/topic/sensor', msg => {
          try {
            const d = JSON.parse(msg.body);
            if (d?.temperature != null) setLatest(d);
          } catch {}
        });
      },
      onDisconnect: () => setWsStatus('disconnected'),
      onStompError:  () => setWsStatus('error'),
    });
    client.activate();
    stompRef.current = client;
    return () => { client.deactivate(); };
  }, []);

  // ── 임계값 판단 ─────────────────────────────────────────────────

  const temp    = latest?.temperature ?? null;
  const hum     = latest?.humidity    ?? null;
  const tempOk  = temp != null && temp >= thresholds.tempMin && temp <= thresholds.tempMax;
  const humOk   = hum  != null && hum  >= thresholds.humMin  && hum  <= thresholds.humMax;
  const anyAlert = temp != null && (!tempOk || !humOk);

  // ── 렌더 ───────────────────────────────────────────────────────

  const btnStyle = (active, color = '#60a5fa') => ({
    fontSize: 11, padding: '2px 9px', borderRadius: 5, cursor: 'pointer',
    background: active ? color + '22' : 'transparent',
    color:      active ? color        : '#6b7280',
    border:     `1px solid ${active ? color : '#253347'}`,
  });

  return (
    <div style={{
      background: '#0a1525', border: `1px solid ${anyAlert ? '#ef4444' : '#253347'}`,
      borderRadius: 12, padding: '14px 18px',
      transition: 'border-color 0.3s',
    }}>

      {/* ── 헤더 ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#4b5563', fontWeight: 600 }}>🌡 현장 센서</span>
          {/* WebSocket 상태 */}
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 8,
            background: wsStatus === 'connected' ? '#0d2211' : '#1a1000',
            border: `1px solid ${wsStatus === 'connected' ? '#4ade80' : '#d97706'}`,
            color: wsStatus === 'connected' ? '#4ade80' : '#d97706',
          }}>
            {wsStatus === 'connected' ? '● LIVE' : '○ 연결 중'}
          </span>
        </div>

        {/* 위치 필터 */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button style={btnStyle(selLocation === '')} onClick={() => setSelLoc('')}>전체</button>
          {locations.map(loc => (
            <button key={loc} style={btnStyle(selLocation === loc)} onClick={() => setSelLoc(loc)}>
              {loc}
            </button>
          ))}
          <button onClick={() => { fetchLatest(); fetchTrend(); }}
            style={{ ...btnStyle(false), marginLeft: 4 }}>↻</button>
        </div>
      </div>

      {/* ── KPI 카드 3개 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>

        {/* 온도 */}
        <div style={{
          background: '#0d1b2a', borderRadius: 10, padding: '12px 14px',
          border: `1px solid ${!tempOk && temp != null ? '#ef4444' : '#1e3a5f'}`,
        }}>
          <p style={{ fontSize: 11, color: '#4b5563', marginBottom: 6 }}>🌡 온도</p>
          <p style={{ fontSize: 26, fontWeight: 700, color: !tempOk && temp != null ? '#f87171' : '#e2e8f0', margin: 0 }}>
            {temp != null ? `${temp.toFixed(1)}°C` : '—'}
          </p>
          <p style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>
            범위 {thresholds.tempMin}~{thresholds.tempMax}°C
          </p>
          {temp != null && <StatusBadge label={tempOk ? '정상' : '임계 초과'} ok={tempOk} />}
        </div>

        {/* 습도 */}
        <div style={{
          background: '#0d1b2a', borderRadius: 10, padding: '12px 14px',
          border: `1px solid ${!humOk && hum != null ? '#ef4444' : '#1e3a5f'}`,
        }}>
          <p style={{ fontSize: 11, color: '#4b5563', marginBottom: 6 }}>💧 습도</p>
          <p style={{ fontSize: 26, fontWeight: 700, color: !humOk && hum != null ? '#f87171' : '#e2e8f0', margin: 0 }}>
            {hum != null ? `${hum.toFixed(1)}%` : '—'}
          </p>
          <p style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>
            범위 {thresholds.humMin}~{thresholds.humMax}%
          </p>
          {hum != null && <StatusBadge label={humOk ? '정상' : '임계 초과'} ok={humOk} />}
        </div>

        {/* 상태 요약 */}
        <div style={{
          background: anyAlert ? '#3a0f0f' : '#0d2211', borderRadius: 10, padding: '12px 14px',
          border: `1px solid ${anyAlert ? '#ef4444' : '#166534'}`,
        }}>
          <p style={{ fontSize: 11, color: '#4b5563', marginBottom: 6 }}>⚡ 종합 상태</p>
          <p style={{ fontSize: 20, margin: '0 0 6px 0' }}>
            {temp == null ? '—' : anyAlert ? '🚨' : '✅'}
          </p>
          <p style={{ fontSize: 12, fontWeight: 600, color: anyAlert ? '#f87171' : '#4ade80', margin: 0 }}>
            {temp == null ? '데이터 없음' : anyAlert ? '경보 발생' : '정상 범위'}
          </p>
          {latest?.location && (
            <p style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>📍 {latest.location}</p>
          )}
          {latest?.timestamp && (
            <p style={{ fontSize: 9, color: '#374151', marginTop: 2 }}>
              {new Date(latest.timestamp).toLocaleTimeString('ko-KR')}
            </p>
          )}
        </div>
      </div>

      {/* ── 그래프 컨트롤 ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { v: 'both',    label: '온도+습도', color: '#a78bfa' },
          { v: 'avgTemp', label: '온도',     color: '#60a5fa' },
          { v: 'avgHum',  label: '습도',     color: '#34d399' },
        ].map(({ v, label, color }) => (
          <button key={v} style={btnStyle(metric === v, color)} onClick={() => setMetric(v)}>
            {label}
          </button>
        ))}
        <div style={{ width: 1, background: '#253347', margin: '0 2px', alignSelf: 'stretch' }} />
        {[
          { h: 6, label: '6h' }, { h: 24, label: '24h' },
          { h: 72, label: '3일' }, { h: 168, label: '7일' },
        ].map(({ h, label }) => (
          <button key={h} style={btnStyle(trendHours === h)} onClick={() => setTrendHours(h)}>
            {label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#374151' }}>
          {trend.length}개 포인트
        </span>
      </div>

      {/* ── 트렌드 그래프 ── */}
      {trend.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#374151', fontSize: 12, padding: '24px 0',
          border: '1px dashed #1e3a5f', borderRadius: 8 }}>
          센서 데이터 없음
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={trend} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="sGradTemp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#60a5fa" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="sGradHum" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#34d399" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a2a3a" />
            <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#4b5563' }}
              tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: '#4b5563' }}
              tickLine={false} axisLine={false} />
            <Tooltip content={<CustomTooltip />} />

            {/* 임계값 기준선 */}
            {(metric === 'avgTemp' || metric === 'both') && (
              <>
                <ReferenceLine y={thresholds.tempMax} stroke="#ef4444"
                  strokeDasharray="4 3" strokeWidth={1}
                  label={{ value: `최대 ${thresholds.tempMax}°C`, fontSize: 9, fill: '#ef4444', position: 'insideTopRight' }} />
                <ReferenceLine y={thresholds.tempMin} stroke="#60a5fa"
                  strokeDasharray="4 3" strokeWidth={1}
                  label={{ value: `최소 ${thresholds.tempMin}°C`, fontSize: 9, fill: '#60a5fa', position: 'insideBottomRight' }} />
              </>
            )}

            {(metric === 'avgTemp' || metric === 'both') && (
              <Area type="monotone" dataKey="avgTemp" name="평균온도"
                stroke="#60a5fa" strokeWidth={2} fill="url(#sGradTemp)" dot={false} />
            )}
            {(metric === 'avgHum' || metric === 'both') && (
              <Area type="monotone" dataKey="avgHum" name="평균습도"
                stroke="#34d399" strokeWidth={2} fill="url(#sGradHum)" dot={false} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}

      <p style={{ fontSize: 9, color: '#374151', marginTop: 6, textAlign: 'right' }}>
        TimescaleDB time_bucket · {trendHours}h · 1분 자동갱신
      </p>
    </div>
  );
}
