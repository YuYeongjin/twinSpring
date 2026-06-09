import { useState, useEffect } from 'react';
import { useIntegration, useIntegrationDispatch } from '../IntegrationStore';

function toSurvey(local, o) { return o ? [local[0] + o.x, local[1] + o.y, local[2] + o.z] : local; }
function toLocal(survey, o) { return o ? [survey[0] - o.x, survey[1] - o.y, survey[2] - o.z] : survey; }

const ZONE_TYPES = [
  { value: 'excavation', label: '굴착 위험', color: '#ef4444' },
  { value: 'restricted', label: '접근 금지', color: '#f97316' },
];

function Label({ children }) {
  return (
    <div style={{
      fontSize: 9, color: '#6b7280', fontWeight: 700, marginBottom: 3,
      textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, step = '0.5', min }) {
  return (
    <input
      type="number"
      value={value}
      onChange={onChange}
      step={step}
      min={min}
      style={{
        background: '#0d1b2a', border: '1px solid #1e3a5f', borderRadius: 4,
        color: '#d1d5db', fontSize: 11, padding: '4px 7px', width: '100%',
        outline: 'none', boxSizing: 'border-box',
      }}
    />
  );
}

export default function ZoneOptionsPanel() {
  const { dangerZones, selectedZoneId, surveyOrigin } = useIntegration();
  const dispatch = useIntegrationDispatch();

  const zone = dangerZones.find(z => z.id === selectedZoneId);
  const [form, setForm] = useState(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (!zone) { setForm(null); return; }
    const localCenter = zone.center || [0, 2, 0];
    const dc = toSurvey(localCenter, surveyOrigin);
    setForm({
      name:   zone.name,
      cx:     dc[0].toString(),
      cy:     dc[1].toString(),
      cz:     dc[2].toString(),
      hx:     (zone.halfSize?.[0] ?? 3).toString(),
      hy:     (zone.halfSize?.[1] ?? 4).toString(),
      hz:     (zone.halfSize?.[2] ?? 3).toString(),
      type:   zone.type || 'excavation',
      active: zone.active !== false,
    });
    setApplied(false);
  }, [selectedZoneId, surveyOrigin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!zone || !form) return null;

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const apply = () => {
    const inputCenter = [parseFloat(form.cx) || 0, parseFloat(form.cy) || 2, parseFloat(form.cz) || 0];
    const localCenter = toLocal(inputCenter, surveyOrigin);
    dispatch({
      type: 'UPDATE_ZONE',
      id: zone.id,
      updates: {
        name:   form.name,
        center: localCenter,
        halfSize: [
          Math.max(0.5, parseFloat(form.hx) || 3),
          Math.max(0.5, parseFloat(form.hy) || 4),
          Math.max(0.5, parseFloat(form.hz) || 3),
        ],
        type:   form.type,
        active: form.active,
      },
    });
    setApplied(true);
    setTimeout(() => {
      setApplied(false);
      dispatch({ type: 'SELECT_ZONE', id: null });
    }, 800);
  };

  const accentColor = ZONE_TYPES.find(t => t.value === form.type)?.color || '#ef4444';

  return (
    <div style={{
      background: '#071323',
      border: `1px solid ${accentColor}55`,
      borderRadius: 8,
      padding: '10px 11px',
      marginBottom: 10,
    }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: accentColor, letterSpacing: '0.06em' }}>
          ⚠ 위험구역 설정
        </div>
        <button
          onClick={() => dispatch({ type: 'SELECT_ZONE', id: null })}
          style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 13, padding: 0 }}
        >✕</button>
      </div>

      {/* 이름 */}
      <div style={{ marginBottom: 8 }}>
        <Label>이름</Label>
        <input
          type="text"
          value={form.name}
          onChange={e => set('name', e.target.value)}
          style={{
            background: '#0d1b2a', border: '1px solid #1e3a5f', borderRadius: 4,
            color: '#d1d5db', fontSize: 11, padding: '4px 7px', width: '100%',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* 유형 */}
      <div style={{ marginBottom: 8 }}>
        <Label>구역 유형</Label>
        <div style={{ display: 'flex', gap: 4 }}>
          {ZONE_TYPES.map(tp => (
            <button
              key={tp.value}
              onClick={() => set('type', tp.value)}
              style={{
                flex: 1,
                background: form.type === tp.value ? `${tp.color}22` : '#0a1525',
                border: `1px solid ${form.type === tp.value ? tp.color : '#1e3a5f'}`,
                borderRadius: 4, padding: '4px 0', cursor: 'pointer',
                color: form.type === tp.value ? tp.color : '#6b7280',
                fontSize: 10, fontWeight: 700,
              }}
            >
              {tp.label}
            </button>
          ))}
        </div>
      </div>

      {/* 중심 좌표 */}
      <div style={{ marginBottom: 8 }}>
        <Label>
          중심 좌표
          {surveyOrigin && (
            <span style={{ color: '#facc15', marginLeft: 5, fontSize: 8, fontWeight: 700, letterSpacing: 0 }}>
              측량좌표
            </span>
          )}
        </Label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
          {[['X', 'cx'], ['Y', 'cy'], ['Z', 'cz']].map(([axis, key]) => (
            <div key={key}>
              <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 2, textAlign: 'center' }}>{axis}</div>
              <NumInput value={form[key]} onChange={e => set(key, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      {/* 크기 (반사이즈) */}
      <div style={{ marginBottom: 8 }}>
        <Label>크기 (반경 X/Y/Z)</Label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
          {[['X', 'hx'], ['Y', 'hy'], ['Z', 'hz']].map(([axis, key]) => (
            <div key={key}>
              <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 2, textAlign: 'center' }}>{axis}</div>
              <NumInput value={form[key]} onChange={e => set(key, e.target.value)} min="0.5" />
            </div>
          ))}
        </div>
        <div style={{ fontSize: 9, color: '#374151', marginTop: 3 }}>
          실제 크기 = 반경 × 2
        </div>
      </div>

      {/* 활성화 */}
      <div style={{ marginBottom: 10 }}>
        <Label>활성화</Label>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { val: true,  label: 'ON',  active: '#1a3a1a', border: '#22c55e', color: '#22c55e' },
            { val: false, label: 'OFF', active: '#1a1a1a', border: '#374151', color: '#4b5563' },
          ].map(opt => (
            <button
              key={String(opt.val)}
              onClick={() => set('active', opt.val)}
              style={{
                flex: 1,
                background: form.active === opt.val ? opt.active : '#0a1525',
                border: `1px solid ${form.active === opt.val ? opt.border : '#1e3a5f'}`,
                borderRadius: 4, padding: '4px 0', cursor: 'pointer',
                color: form.active === opt.val ? opt.color : '#6b7280',
                fontSize: 10, fontWeight: 700,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 적용 버튼 */}
      <button
        onClick={apply}
        disabled={applied}
        style={{
          width: '100%',
          background: applied ? `${accentColor}22` : '#1e3a5f',
          border: `1px solid ${applied ? accentColor : '#60a5fa'}`,
          borderRadius: 5, padding: '6px 0',
          color: applied ? accentColor : '#60a5fa',
          fontSize: 11, fontWeight: 700,
          cursor: applied ? 'default' : 'pointer',
          transition: 'all 0.2s',
        }}
      >
        {applied ? '✓ 적용됨' : '적용'}
      </button>
    </div>
  );
}
