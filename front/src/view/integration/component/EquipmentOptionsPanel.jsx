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

export default function EquipmentOptionsPanel() {
  const t = useT('integrationProject');
  const { equipment, selectedEquipId } = useIntegration();
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
    });
    setApplied(false);
  }, [selectedEquipId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!equip || !form) return null;

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

      {/* 자동 모드: 속도 */}
      {form.mode === 'auto' && (
        <div style={{ marginBottom: 8 }}>
          <Label>{t('equipSpeedLabel')}</Label>
          <Input type="number" value={form.speed} min="0" step="0.1" onChange={e => set('speed', e.target.value)} />
          <div style={{ fontSize: 9, color: '#374151', marginTop: 3 }}>
            {t('waypointCount', { n: equip.route?.length ?? 0 })}
          </div>
        </div>
      )}

      {/* GPS 모드: 디바이스 ID */}
      {form.mode === 'gps' && (
        <div style={{ marginBottom: 8 }}>
          <Label>{t('gpsDeviceLabel')}</Label>
          <Input
            value={form.gpsDeviceId}
            placeholder="excavator"
            onChange={e => set('gpsDeviceId', e.target.value)}
          />
          <div style={{ fontSize: 9, color: '#374151', marginTop: 3 }}>
            {t('gpsWsNote')}
          </div>
          {equip.gpsPos && (
            <div style={{ fontSize: 9, color: '#22c55e', marginTop: 3 }}>
              {t('gpsReceiving', { pos: equip.gpsPos.map(v => v.toFixed(1)).join(', ') })}
            </div>
          )}
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
        {applied ? '✓ 적용됨' : t('equipApply')}
      </button>
    </div>
  );
}
