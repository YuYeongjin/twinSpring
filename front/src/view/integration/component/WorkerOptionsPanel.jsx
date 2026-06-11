import { useState, useEffect } from 'react';
import { useIntegration, useIntegrationDispatch } from '../IntegrationStore';
import { useT } from '../../../i18n/LanguageContext';

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

function LivePosBox({ pos, surveyOrigin, t }) {
  if (!pos) return null;
  const hasSurvey = !!surveyOrigin;
  const [dx, dy, dz] = hasSurvey
    ? [pos[0] + surveyOrigin.x, pos[1] + surveyOrigin.y, pos[2] + surveyOrigin.z]
    : pos;
  const badge = hasSurvey ? t('surveyCoordBadge') : t('currentPosLabel');
  return (
    <div style={{
      background: '#0a1a0a', border: '1px solid #facc1555',
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

export default function WorkerOptionsPanel() {
  const t = useT('integrationProject');
  const { workers, selectedWorkerId, surveyOrigin, livePositions, wbsTasks } = useIntegration();
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
      assignedWbsTaskId: worker.assignedWbsTaskId || null,
    });
    setApplied(false);
  }, [selectedWorkerId, surveyOrigin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!worker || !form) return null;

  const livePos = livePositions?.workers?.[worker.id] ?? (worker.initialPos || [0, 0, 0]);
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const apply = () => {
    const inputPos = [parseFloat(form.posX) || 0, parseFloat(form.posY) || 0, parseFloat(form.posZ) || 0];
    const localPos = toLocal(inputPos, surveyOrigin);
    dispatch({
      type: 'UPDATE_WORKER',
      id: worker.id,
      updates: {
        name:              form.name,
        initialPos:        localPos,
        gear:              form.gear,
        assignedWbsTaskId: form.assignedWbsTaskId || null,
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
          👷 {t('workerSetting')}
        </div>
        <button
          onClick={() => dispatch({ type: 'SELECT_WORKER', id: null })}
          style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 13, padding: 0 }}
        >✕</button>
      </div>

      {/* 실시간 현재 좌표 */}
      <LivePosBox pos={livePos} surveyOrigin={surveyOrigin} t={t} />

      {/* 이름 */}
      <div style={{ marginBottom: 8 }}>
        <Label>{t('nameLabel')}</Label>
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
          {t('startPosLabel')}
          {surveyOrigin && (
            <span style={{ color: '#facc15', marginLeft: 5, fontSize: 8, fontWeight: 700, letterSpacing: 0 }}>
              {t('surveyCoordBadge')}
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
        <Label>{t('gearLabel')}</Label>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { val: true,  label: t('gearOn'),  active: '#1a3a1a', border: '#22c55e', color: '#22c55e' },
            { val: false, label: t('gearOff'), active: '#3a1a1a', border: '#ef4444', color: '#ef4444' },
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

      {/* 담당 작업 배정 */}
      <div style={{ marginBottom: 10 }}>
        <Label>{t('assignTaskLabel') || '담당 작업'}</Label>
        <select
          value={form.assignedWbsTaskId || ''}
          onChange={e => set('assignedWbsTaskId', e.target.value || null)}
          style={{
            width: '100%', background: '#0d1b2a', border: '1px solid #1e3a5f',
            borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '4px 7px',
            outline: 'none',
          }}
        >
          <option value="">{t('noTask') || '— 없음 —'}</option>
          {(wbsTasks || [])
            .filter(tk => !(tk.notes || '').startsWith('BIM_SUB:') && tk.taskName)
            .map(tk => (
              <option key={tk.taskId} value={tk.taskId}>
                {tk.taskName}
              </option>
            ))
          }
        </select>
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
        {applied ? t('applied') : t('equipApply')}
      </button>
    </div>
  );
}
