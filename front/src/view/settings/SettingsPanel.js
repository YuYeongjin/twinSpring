import { useEffect, useState, useCallback } from 'react';
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
