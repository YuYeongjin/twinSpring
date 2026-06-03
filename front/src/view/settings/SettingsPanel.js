import { useEffect, useState, useCallback } from 'react';
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
