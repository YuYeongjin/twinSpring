import { useState, useEffect } from 'react';
import { useIntegration, useIntegrationDispatch } from '../IntegrationStore';

// survey ↔ local 변환 (surveyOrigin이 scene origin [0,0,0]의 실좌표)
function toSurvey(local, o) { return o ? [local[0] + o.x, local[1] + o.y, local[2] + o.z] : local; }
function toLocal(survey, o) { return o ? [survey[0] - o.x, survey[1] - o.y, survey[2] - o.z] : survey; }

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

function NumInput({ value, onChange, step = '0.5' }) {
  return (
    <input
      type="number"
      value={value}
      onChange={onChange}
      step={step}
      style={{
        background: '#0d1b2a', border: '1px solid #1e3a5f', borderRadius: 4,
        color: '#d1d5db', fontSize: 11, padding: '4px 7px', width: '100%',
        outline: 'none', boxSizing: 'border-box',
      }}
    />
  );
}

export default function WorkerOptionsPanel() {
  const { workers, selectedWorkerId, surveyOrigin } = useIntegration();
  const dispatch = useIntegrationDispatch();

  const worker = workers.find(w => w.id === selectedWorkerId);
  const [form, setForm] = useState(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (!worker) { setForm(null); return; }
    const local = worker.initialPos || [0, 0, 0];
    const display = toSurvey(local, surveyOrigin);
    setForm({
      name: worker.name,
      posX: display[0].toString(),
      posY: display[1].toString(),
      posZ: display[2].toString(),
      gear: worker.gear !== false,
    });
    setApplied(false);
  }, [selectedWorkerId, surveyOrigin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!worker || !form) return null;

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const apply = () => {
    const inputPos = [parseFloat(form.posX) || 0, parseFloat(form.posY) || 0, parseFloat(form.posZ) || 0];
    const localPos = toLocal(inputPos, surveyOrigin);
    dispatch({
      type: 'UPDATE_WORKER',
      id: worker.id,
      updates: {
        name:       form.name,
        initialPos: localPos,
        gear:       form.gear,
      },
    });
    setApplied(true);
    setTimeout(() => {
      setApplied(false);
      dispatch({ type: 'SELECT_WORKER', id: null });
    }, 800);
  };

  return (
    <div style={{
      background: '#071323',
      border: '1px solid #1e4a2a',
      borderRadius: 8,
      padding: '10px 11px',
      marginBottom: 10,
    }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#22c55e', letterSpacing: '0.06em' }}>
          👷 작업자 설정
        </div>
        <button
          onClick={() => dispatch({ type: 'SELECT_WORKER', id: null })}
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

      {/* 시작 위치 */}
      <div style={{ marginBottom: 8 }}>
        <Label>
          시작 위치
          {surveyOrigin && (
            <span style={{ color: '#facc15', marginLeft: 5, fontSize: 8, fontWeight: 700, letterSpacing: 0 }}>
              측량좌표
            </span>
          )}
        </Label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
          {[['X', 'posX'], ['Y', 'posY'], ['Z', 'posZ']].map(([axis, key]) => (
            <div key={key}>
              <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 2, textAlign: 'center' }}>{axis}</div>
              <NumInput value={form[key]} onChange={e => set(key, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      {/* 보호장비 */}
      <div style={{ marginBottom: 10 }}>
        <Label>보호장비</Label>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { val: true,  label: '✓ 착용',   active: '#1a3a1a', border: '#22c55e', color: '#22c55e' },
            { val: false, label: '✗ 미착용', active: '#3a1a1a', border: '#ef4444', color: '#ef4444' },
          ].map(opt => (
            <button
              key={String(opt.val)}
              onClick={() => set('gear', opt.val)}
              style={{
                flex: 1,
                background: form.gear === opt.val ? opt.active : '#0a1525',
                border: `1px solid ${form.gear === opt.val ? opt.border : '#1e3a5f'}`,
                borderRadius: 4, padding: '4px 0', cursor: 'pointer',
                color: form.gear === opt.val ? opt.color : '#6b7280',
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
          background: applied ? '#1a3a1a' : '#1e3a5f',
          border: `1px solid ${applied ? '#22c55e' : '#60a5fa'}`,
          borderRadius: 5, padding: '6px 0',
          color: applied ? '#22c55e' : '#60a5fa',
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
