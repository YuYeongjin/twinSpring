import { useState, useEffect } from 'react';
import { useIntegration, useIntegrationDispatch } from '../IntegrationStore';
import { useT } from '../../../i18n/LanguageContext';

const TYPES = [
  { value: 'excavator', tKey: 'equipExcavator', icon: '🚜' },
  { value: 'dump',      tKey: 'equipDump',      icon: '🚛' },
  { value: 'crane',     tKey: 'equipCrane',     icon: '🏗' },
  { value: 'vehicle',   tKey: 'equipVehicle',   icon: '🚗' },
  { value: 'other',     tKey: 'equipOther',     icon: '🔧' },
];

const TYPE_DEFAULT_SIZE = {
  excavator: [2.8, 2.5, 3.5],
  dump:      [2.8, 2.5, 3.5],
  crane:     [1.5, 9.0, 1.5],
  vehicle:   [2.0, 1.8, 4.0],
  other:     [1.5, 1.5, 1.5],
};

const MODE_KEYS = [
  { value: 'auto',    labelKey: 'modeAuto',    descKey: 'modeAutoDesc' },
  { value: 'standby', labelKey: 'modeStandby', descKey: 'modeStandbyDesc' },
  { value: 'gps',     labelKey: null,          descKey: 'modeGpsDesc' },
];

// scene coords ↔ display coords (survey if origin set)
function sceneToDisplay(sceneXZ, o) {
  return o ? [sceneXZ[0] + o.x, sceneXZ[1] + o.z] : sceneXZ;
}
function displayToScene(dispXZ, o) {
  return o ? [dispXZ[0] - o.x, dispXZ[1] - o.z] : dispXZ;
}

function routeToForm(route, o) {
  return (route || []).map(pt => {
    const [dx, dz] = sceneToDisplay([pt[0], pt[2]], o);
    return { x: dx.toFixed(1), z: dz.toFixed(1) };
  });
}
function formToRoute(formRoute, o) {
  return formRoute.map(pt => {
    const x = parseFloat(pt.x) || 0;
    const z = parseFloat(pt.z) || 0;
    const [sx, sz] = displayToScene([x, z], o);
    return [sx, 0, sz];
  });
}

function Label({ children }) {
  return (
    <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', step, min, placeholder }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      step={step}
      min={min}
      placeholder={placeholder}
      style={{
        background: '#0d1b2a', border: '1px solid #1e3a5f', borderRadius: 4,
        color: '#d1d5db', fontSize: 11, padding: '4px 7px', width: '100%',
        outline: 'none', boxSizing: 'border-box',
      }}
    />
  );
}

function SmallBtn({ onClick, title, children, active, danger }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: active ? '#1e3a5f' : danger ? '#2a0f0f' : '#0d1b2a',
        border: `1px solid ${active ? '#60a5fa' : danger ? '#7f1d1d' : '#1e3a5f'}`,
        borderRadius: 3, padding: '2px 5px', cursor: 'pointer',
        color: active ? '#93c5fd' : danger ? '#f87171' : '#6b7280',
        fontSize: 10, lineHeight: 1.4, flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function LivePosBox({ pos, surveyOrigin, t }) {
  if (!pos) return null;
  const hasSurvey = !!surveyOrigin;
  const [dx, dy, dz] = hasSurvey
    ? [pos[0] + surveyOrigin.x, pos[1] + surveyOrigin.y, pos[2] + surveyOrigin.z]
    : pos;
  const badge = hasSurvey ? t('surveyCoordBadge') : t('currentPosLabel');
  return (
    <div style={{
      background: '#070e1a', border: '1px solid #facc1555',
      borderRadius: 5, padding: '6px 9px', marginBottom: 9,
    }}>
      <div style={{ fontSize: 8, color: '#facc15', fontWeight: 700, marginBottom: 4, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        📍 {badge}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
        {[['X', dx], ['Y', dy], ['Z', dz]].map(([axis, val]) => (
          <div key={axis} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: '#4b5563', marginBottom: 1 }}>{axis}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#facc15', letterSpacing: '0.02em' }}>
              {val.toFixed(1)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 웨이포인트 편집기 ────────────────────────────────────────────
function RouteEditor({ route, onChange, surveyOrigin, livePos, t }) {
  const hasSurvey = !!surveyOrigin;

  const add = () => {
    onChange([...route, { x: '0', z: '0' }]);
  };

  const addCurrent = () => {
    if (!livePos) return;
    const [dx, dz] = sceneToDisplay([livePos[0], livePos[2]], surveyOrigin);
    onChange([...route, { x: dx.toFixed(1), z: dz.toFixed(1) }]);
  };

  const remove = (i) => onChange(route.filter((_, idx) => idx !== i));

  const update = (i, key, val) =>
    onChange(route.map((pt, idx) => idx === i ? { ...pt, [key]: val } : pt));

  const moveUp = (i) => {
    if (i === 0) return;
    const next = [...route];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  };

  const moveDown = (i) => {
    if (i === route.length - 1) return;
    const next = [...route];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    onChange(next);
  };

  const coordLabel = hasSurvey ? t('surveyCoordBadge') : t('routeCoordHint');

  return (
    <div style={{ marginBottom: 8 }}>
      {/* 헤더 행 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <Label>
          {t('routeLabel')}
          <span style={{ color: hasSurvey ? '#facc15' : '#4b5563', marginLeft: 5, fontSize: 8, fontWeight: 700, letterSpacing: 0, textTransform: 'none' }}>
            {coordLabel}
          </span>
        </Label>
        <div style={{ display: 'flex', gap: 3 }}>
          {livePos && (
            <SmallBtn onClick={addCurrent} title={t('routeAddCurrent')}>
              📍
            </SmallBtn>
          )}
          <SmallBtn onClick={add} active>
            {t('routeAddPoint')}
          </SmallBtn>
        </div>
      </div>

      {/* 경고 — 포인트 부족 */}
      {route.length < 2 && (
        <div style={{ fontSize: 9, color: '#f59e0b', marginBottom: 5, padding: '3px 6px', background: '#1c1200', borderRadius: 3, border: '1px solid #78350f' }}>
          {t('routeNeedTwo')}
        </div>
      )}

      {/* 웨이포인트 목록 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {route.map((pt, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            {/* 인덱스 */}
            <span style={{ fontSize: 9, color: '#374151', width: 14, textAlign: 'right', flexShrink: 0 }}>
              {i + 1}
            </span>
            {/* X 입력 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 8, color: '#4b5563', textAlign: 'center', marginBottom: 1 }}>X</div>
              <input
                type="number"
                value={pt.x}
                step="0.5"
                onChange={e => update(i, 'x', e.target.value)}
                style={{
                  background: '#0d1b2a', border: '1px solid #1e3a5f', borderRadius: 3,
                  color: '#d1d5db', fontSize: 10, padding: '3px 5px', width: '100%',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            {/* Z 입력 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 8, color: '#4b5563', textAlign: 'center', marginBottom: 1 }}>Z</div>
              <input
                type="number"
                value={pt.z}
                step="0.5"
                onChange={e => update(i, 'z', e.target.value)}
                style={{
                  background: '#0d1b2a', border: '1px solid #1e3a5f', borderRadius: 3,
                  color: '#d1d5db', fontSize: 10, padding: '3px 5px', width: '100%',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            {/* 순서 변경 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
              <button
                onClick={() => moveUp(i)}
                disabled={i === 0}
                style={{
                  background: 'none', border: '1px solid #1e3a5f', borderRadius: 2,
                  color: i === 0 ? '#1e3a5f' : '#4b5563', cursor: i === 0 ? 'default' : 'pointer',
                  fontSize: 8, padding: '1px 4px', lineHeight: 1,
                }}
              >▲</button>
              <button
                onClick={() => moveDown(i)}
                disabled={i === route.length - 1}
                style={{
                  background: 'none', border: '1px solid #1e3a5f', borderRadius: 2,
                  color: i === route.length - 1 ? '#1e3a5f' : '#4b5563',
                  cursor: i === route.length - 1 ? 'default' : 'pointer',
                  fontSize: 8, padding: '1px 4px', lineHeight: 1,
                }}
              >▼</button>
            </div>
            {/* 삭제 */}
            <SmallBtn onClick={() => remove(i)} danger title="삭제">✕</SmallBtn>
          </div>
        ))}

        {route.length === 0 && (
          <div style={{ fontSize: 9, color: '#374151', textAlign: 'center', padding: '6px 0' }}>
            —
          </div>
        )}
      </div>
    </div>
  );
}

// ── 메인 패널 ────────────────────────────────────────────────────
export default function EquipmentOptionsPanel() {
  const t = useT('integrationProject');
  const { equipment, selectedEquipId, surveyOrigin, livePositions } = useIntegration();
  const dispatch = useIntegrationDispatch();

  const equip = equipment.find(e => e.id === selectedEquipId);

  const [form, setForm] = useState(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (!equip) { setForm(null); return; }
    setForm({
      name:        equip.name,
      type:        equip.type        || 'excavator',
      sizeW:       (equip.size?.[0]  ?? 2.8).toString(),
      sizeH:       (equip.size?.[1]  ?? 2.5).toString(),
      sizeD:       (equip.size?.[2]  ?? 3.5).toString(),
      mode:        equip.mode        || 'auto',
      speed:       (equip.speed      ?? 1.5).toString(),
      gpsDeviceId: equip.gpsDeviceId || '',
      route:       routeToForm(equip.route, surveyOrigin),
    });
    setApplied(false);
  }, [selectedEquipId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!equip || !form) return null;

  const livePos = livePositions?.equipment?.[equip.id] ?? (equip.initialPos || [0, 0, 0]);
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const apply = () => {
    const size = [
      parseFloat(form.sizeW) || 2.8,
      parseFloat(form.sizeH) || 2.5,
      parseFloat(form.sizeD) || 3.5,
    ];
    dispatch({
      type: 'UPDATE_EQUIPMENT',
      id: equip.id,
      updates: {
        name:        form.name,
        type:        form.type,
        size,
        mode:        form.mode,
        speed:       form.mode === 'auto' ? (parseFloat(form.speed) || 0) : 0,
        gpsDeviceId: form.gpsDeviceId || null,
        route:       formToRoute(form.route, surveyOrigin),
      },
    });
    setApplied(true);
    setTimeout(() => {
      setApplied(false);
      dispatch({ type: 'SELECT_EQUIPMENT', id: null });
    }, 800);
  };

  const handleTypeChange = (newType) => {
    const defSize = TYPE_DEFAULT_SIZE[newType] || [1.5, 1.5, 1.5];
    setForm(f => ({
      ...f,
      type:  newType,
      sizeW: defSize[0].toString(),
      sizeH: defSize[1].toString(),
      sizeD: defSize[2].toString(),
    }));
  };

  return (
    <div style={{
      background: '#071323',
      border: '1px solid #1e3a5f',
      borderRadius: 8,
      padding: '10px 11px',
      marginBottom: 10,
    }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#60a5fa', letterSpacing: '0.06em' }}>
          ⚙ {t('equipSetting')}
        </div>
        <button
          onClick={() => dispatch({ type: 'SELECT_EQUIPMENT', id: null })}
          style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 13, padding: 0 }}
        >✕</button>
      </div>

      {/* 실시간 현재 좌표 */}
      <LivePosBox pos={livePos} surveyOrigin={surveyOrigin} t={t} />

      {/* 이름 */}
      <div style={{ marginBottom: 8 }}>
        <Label>{t('equipNameLabel')}</Label>
        <Input value={form.name} onChange={e => set('name', e.target.value)} />
      </div>

      {/* 종류 */}
      <div style={{ marginBottom: 8 }}>
        <Label>{t('equipTypeLabel')}</Label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {TYPES.map(tp => (
            <button
              key={tp.value}
              onClick={() => handleTypeChange(tp.value)}
              style={{
                background: form.type === tp.value ? '#1e3a5f' : '#0a1525',
                border: `1px solid ${form.type === tp.value ? '#60a5fa' : '#1e3a5f'}`,
                borderRadius: 4, padding: '3px 7px', cursor: 'pointer',
                color: form.type === tp.value ? '#60a5fa' : '#6b7280',
                fontSize: 10, fontWeight: 700,
              }}
            >
              {tp.icon} {t(tp.tKey)}
            </button>
          ))}
        </div>
      </div>

      {/* 사이즈 */}
      <div style={{ marginBottom: 8 }}>
        <Label>{t('equipSizeLabel')}</Label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
          <Input type="number" value={form.sizeW} min="0.1" step="0.1" placeholder="W" onChange={e => set('sizeW', e.target.value)} />
          <Input type="number" value={form.sizeH} min="0.1" step="0.1" placeholder="H" onChange={e => set('sizeH', e.target.value)} />
          <Input type="number" value={form.sizeD} min="0.1" step="0.1" placeholder="D" onChange={e => set('sizeD', e.target.value)} />
        </div>
      </div>

      {/* 모드 */}
      <div style={{ marginBottom: 8 }}>
        <Label>{t('equipModeLabel')}</Label>
        <div style={{ display: 'flex', gap: 4 }}>
          {MODE_KEYS.map(m => (
            <button
              key={m.value}
              onClick={() => set('mode', m.value)}
              title={t(m.descKey)}
              style={{
                flex: 1,
                background: form.mode === m.value ? '#1e3a5f' : '#0a1525',
                border: `1px solid ${form.mode === m.value ? '#60a5fa' : '#1e3a5f'}`,
                borderRadius: 4, padding: '4px 0', cursor: 'pointer',
                color: form.mode === m.value ? '#60a5fa' : '#6b7280',
                fontSize: 10, fontWeight: 700,
              }}
            >
              {m.labelKey ? t(m.labelKey) : 'GPS'}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 9, color: '#374151', marginTop: 3 }}>
          {t(MODE_KEYS.find(m => m.value === form.mode)?.descKey)}
        </div>
      </div>

      {/* 자동 모드: 속도 + 경로 편집 */}
      {form.mode === 'auto' && (
        <>
          <div style={{ marginBottom: 8 }}>
            <Label>{t('equipSpeedLabel')}</Label>
            <Input type="number" value={form.speed} min="0" step="0.1" onChange={e => set('speed', e.target.value)} />
          </div>

          <div style={{ borderTop: '1px solid #111e2d', paddingTop: 8, marginBottom: 8 }}>
            <RouteEditor
              route={form.route}
              onChange={r => set('route', r)}
              surveyOrigin={surveyOrigin}
              livePos={livePos}
              t={t}
            />
          </div>
        </>
      )}

      {/* GPS 모드: 장비 ID 입력 */}
      {form.mode === 'gps' && (
        <div style={{ marginBottom: 8 }}>
          <Label>{t('gpsDeviceLabel')}</Label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 5 }}>
            {[
              { id: 'excavator', labelKey: 'gpsDeviceExcavator' },
              { id: 'dump-1',    labelKey: 'gpsDeviceDump' },
              { id: 'crane-1',   labelKey: 'gpsDeviceCrane' },
            ].map(opt => (
              <button
                key={opt.id}
                onClick={() => set('gpsDeviceId', opt.id)}
                style={{
                  background: form.gpsDeviceId === opt.id ? '#1e3a5f' : '#0a1525',
                  border: `1px solid ${form.gpsDeviceId === opt.id ? '#60a5fa' : '#1e3a5f'}`,
                  borderRadius: 4, padding: '3px 7px', cursor: 'pointer',
                  color: form.gpsDeviceId === opt.id ? '#60a5fa' : '#6b7280',
                  fontSize: 9, fontWeight: 700,
                }}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
          <Input
            value={form.gpsDeviceId}
            placeholder={t('gpsDeviceIdPlaceholder')}
            onChange={e => set('gpsDeviceId', e.target.value)}
          />
          <div style={{ fontSize: 9, marginTop: 3 }}>
            {equip.gpsPos ? (
              <span style={{ color: '#22c55e' }}>
                {t('gpsStatusReceiving', { x: equip.gpsPos[0].toFixed(1), z: equip.gpsPos[2].toFixed(1) })}
              </span>
            ) : (
              <span style={{ color: '#4b5563' }}>{t('gpsStatusWaiting')}</span>
            )}
          </div>
        </div>
      )}

      {/* 적용 버튼 */}
      <button
        onClick={apply}
        disabled={applied}
        style={{
          width: '100%',
          background: applied ? '#1a3a1a' : '#1e3a5f',
          border: `1px solid ${applied ? '#22c55e' : '#60a5fa'}`,
          borderRadius: 5, padding: '6px 0',
          color: applied ? '#22c55e' : '#60a5fa',
          fontSize: 11, fontWeight: 700,
          cursor: applied ? 'default' : 'pointer',
          transition: 'all 0.2s',
        }}
      >
        {applied ? t('applied') : t('equipApply')}
      </button>
    </div>
  );
}
