import { useMemo, useState } from 'react';
import { useIntegration } from '../IntegrationStore';
import { useT } from '../../../i18n/LanguageContext';
import { calcProgressRate, predictCompletion, getRecommendations } from '../progressEngine';
import AxiosCustom from '../../../axios/AxiosCustom';

const TASK_STATUS_META = {
  NOT_STARTED: { labelKey: 'taskNotStarted', color: '#94a3b8' },
  IN_PROGRESS: { labelKey: 'taskInProgress', color: '#60a5fa' },
  COMPLETED:   { labelKey: 'taskCompleted',  color: '#4ade80' },
  DELAYED:     { labelKey: 'taskDelayed',    color: '#ef4444' },
};
const BAR_COLORS = ['#22c55e', '#f59e0b', '#3b82f6', '#a855f7', '#f97316', '#06b6d4'];

const ELEM_LABEL_KEY = {
  IfcSlab: 'ifcSlab', IfcColumn: 'ifcColumn',
  IfcBeam: 'ifcBeam', IfcWall:  'ifcWall',  IfcPier: 'ifcPier',
};

const PROGRESS_COLOR = p =>
  p >= 100 ? '#60a5fa' : p >= 75 ? '#22c55e' : p >= 40 ? '#eab308' : p > 0 ? '#f97316' : '#1e3a5f';

function fmtDate(d) {
  if (!d) return '';
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}`;
}

// ── 시방서 인용 패널 ──────────────────────────────────────────
function SpecPanel({ citations, loading, hasData, t }) {
  if (loading) return (
    <div style={{ fontSize: 9, color: '#60a5fa', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
      {t('specSearching')}
    </div>
  );
  if (!hasData || !citations?.length) return (
    <div style={{ fontSize: 9, color: '#374151', padding: '4px 0' }}>{t('specNone')}</div>
  );
  return (
    <div style={{ marginTop: 4 }}>
      {citations.map((c, i) => (
        <div key={i} style={{
          marginBottom: 5, padding: '5px 7px',
          background: '#060f18', borderRadius: 3, border: '1px solid #1e3a5f',
        }}>
          <div style={{ fontSize: 8, color: '#60a5fa', fontWeight: 700, marginBottom: 2 }}>
            📋 {c.source}
            {c.series && <span style={{ color: '#4b5563', fontWeight: 400 }}> · {c.series}</span>}
          </div>
          <div style={{ fontSize: 8, color: '#6b7280', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {c.content.length > 200 ? c.content.slice(0, 200) + '…' : c.content}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── RAG 시방서 조회 훅 ────────────────────────────────────────
function useSpecQuery(taskName, elementType, status) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState(null);

  const toggle = async (e) => {
    e && e.stopPropagation();
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (data) return;
    setLoading(true);
    try {
      const res = await AxiosCustom.post('/api/chat/wbs-task-spec', {
        taskName: taskName || '',
        elementType: elementType || '',
        status: status || '',
      });
      setData(res.data);
    } catch {
      setData({ citations: [], hasData: false });
    } finally {
      setLoading(false);
    }
  };

  return { open, loading, data, toggle };
}

// ── 일반 WBS 진도 바 ──────────────────────────────────────────
function Bar({ label, value, color, status, tWbs, t }) {
  const sm = TASK_STATUS_META[status];
  const spec = useSpecQuery(label, '', status);

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: '#8896a4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {sm && <span style={{ fontSize: 8, color: sm.color, fontWeight: 700 }}>{tWbs(sm.labelKey) || sm.labelKey}</span>}
          <span style={{ fontSize: 10, fontWeight: 700, color }}>{Math.round(value ?? 0)}%</span>
          <button
            onClick={spec.toggle}
            title={t('specQueryTitle')}
            style={{
              background: spec.open ? '#1e3a5f' : 'none',
              border: '1px solid #1e3a5f',
              borderRadius: 3,
              cursor: 'pointer',
              color: spec.open ? '#93c5fd' : '#4b6a8a',
              fontSize: 8,
              padding: '1px 4px',
              lineHeight: 1.4,
              transition: 'color 0.15s, background 0.15s',
            }}
          >
            📋
          </button>
        </div>
      </div>
      <div style={{ background: '#111e2d', borderRadius: 4, height: 5, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, value ?? 0)}%`, background: color, borderRadius: 4, transition: 'width 1.2s ease' }} />
      </div>
      {spec.open && (
        <SpecPanel citations={spec.data?.citations} loading={spec.loading} hasData={spec.data?.hasData} t={t} />
      )}
    </div>
  );
}

// ── BIM 공종 행 (클릭하면 추천 + 시방서 펼침) ─────────────────
function BimPredRow({ task, workers, equipment, t }) {
  const [open, setOpen] = useState(false);

  const elementType = task.notes.split(':')[2];
  const progress    = task.progress || 0;

  const { rate, blocked } = useMemo(
    () => calcProgressRate(elementType, workers, equipment),
    [elementType, workers, equipment]
  );
  const pred = useMemo(
    () => (blocked ? null : predictCompletion(task, rate)),
    [task, rate, blocked]
  );
  const recs = useMemo(
    () => getRecommendations(elementType, workers, equipment),
    [elementType, workers, equipment]
  );

  const elemLabel = t(ELEM_LABEL_KEY[elementType]) || elementType;

  const spec = useSpecQuery(
    task.taskName || elemLabel,
    elementType,
    task.status || ''
  );

  let statusText, statusColor;
  if (progress >= 100) {
    statusText = t('statusDone');    statusColor = '#60a5fa';
  } else if (blocked) {
    statusText = t('statusBlocked'); statusColor = '#ef4444';
  } else if (!pred) {
    statusText = '—';                statusColor = '#374151';
  } else if (pred.isDelayed) {
    statusText = `${fmtDate(pred.predictedDate)} ${t('delayDays', { n: pred.delayDays })}`;
    statusColor = '#f59e0b';
  } else {
    statusText = fmtDate(pred.predictedDate);
    statusColor = '#8896a4';
  }

  return (
    <div style={{ marginBottom: 8 }}>
      {/* 클릭 가능한 행 */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', background: 'none', border: 'none',
          cursor: 'pointer', padding: 0, textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: '#8896a4', flexShrink: 0, width: 58, textAlign: 'left' }}>
            {elemLabel}
          </span>
          <div style={{ flex: 1, background: '#111e2d', borderRadius: 2, height: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${Math.min(100, progress)}%`,
              background: PROGRESS_COLOR(progress), transition: 'width 1.2s ease',
            }} />
          </div>
          <span style={{ fontSize: 9, color: '#6b7280', flexShrink: 0, width: 24, textAlign: 'right' }}>
            {Math.round(progress)}%
          </span>
          <span style={{ fontSize: 9, color: statusColor, flexShrink: 0, width: 72, textAlign: 'right' }}>
            {statusText}
          </span>
        </div>
      </button>

      {/* 펼침 패널: 자원 추천 + 시방서 조회 */}
      {open && (
        <div style={{ paddingLeft: 8, marginTop: 2, borderLeft: '1px solid #1e3a5f' }}>
          {recs.map((rec, i) => (
            <div key={i} style={{ fontSize: 9, color: '#6b7280', lineHeight: 1.6 }}>
              {rec.text}
            </div>
          ))}

          {/* 시방서 조회 버튼 */}
          <div style={{ marginTop: recs.length > 0 ? 6 : 2, borderTop: recs.length > 0 ? '1px solid #0d1b2a' : 'none', paddingTop: recs.length > 0 ? 5 : 0 }}>
            <button
              onClick={spec.toggle}
              style={{
                background: spec.open ? '#1e3a5f' : 'none',
                border: '1px solid #1e3a5f',
                borderRadius: 3,
                cursor: 'pointer',
                color: spec.open ? '#93c5fd' : '#4b6a8a',
                fontSize: 8,
                padding: '2px 7px',
                lineHeight: 1.5,
                transition: 'color 0.15s, background 0.15s',
              }}
            >
              {spec.open ? t('specBtnClose') : t('specBtnOpen')}
            </button>
            {spec.open && (
              <SpecPanel citations={spec.data?.citations} loading={spec.loading} hasData={spec.data?.hasData} t={t} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── BIM 공정 예측 섹션 ───────────────────────────────────────
function BimPredictionSection({ bimTasks, workers, equipment, t }) {
  const [open, setOpen] = useState(false);
  if (!bimTasks.length) return null;

  return (
    <div style={{ borderTop: '1px solid #111e2d', marginTop: 4, paddingTop: 6 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '2px 0', marginBottom: open ? 8 : 0,
        }}
      >
        <span style={{ fontSize: 9, fontWeight: 700, color: '#4b5563', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {t('bimPredTitle')}
        </span>
        <span style={{ fontSize: 9, color: '#374151' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && bimTasks.map(task => (
        <BimPredRow key={task.taskId} task={task} workers={workers} equipment={equipment} t={t} />
      ))}
    </div>
  );
}

// ── 메인 패널 ────────────────────────────────────────────────
export default function WbsProgressPanel() {
  const t    = useT('integrationProject');
  const tWbs = useT('wbs');
  const { wbsTasks, workers, equipment, isLoading } = useIntegration();

  const overall = wbsTasks.length > 0
    ? Math.round(wbsTasks.reduce((s, tk) => s + (tk.progress || 0), 0) / wbsTasks.length)
    : 0;

  const bimTasks = useMemo(
    () => wbsTasks.filter(t => typeof t.notes === 'string' && /^BIM:[^:]+:[^:]+/.test(t.notes)),
    [wbsTasks]
  );
  const regularTasks = useMemo(
    () => wbsTasks.filter(t => !bimTasks.includes(t)),
    [wbsTasks, bimTasks]
  );

  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #111e2d', flexShrink: 0, maxHeight: 400, overflowY: 'auto' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#4b5563', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
        {t('wbsProgressTitle')}
      </div>

      {isLoading && (
        <div style={{ color: '#374151', fontSize: 10, textAlign: 'center', padding: '8px 0' }}>{t('loading')}</div>
      )}
      {!isLoading && wbsTasks.length === 0 && (
        <div style={{ color: '#374151', fontSize: 10, textAlign: 'center', padding: '8px 0' }}>{t('wbsNoTasks')}</div>
      )}

      {!isLoading && wbsTasks.length > 0 && (
        <>
          <Bar label={t('wbsOverall')} value={overall} color="#60a5fa" tWbs={tWbs} t={t} />

          {regularTasks.length > 0 && (
            <>
              <div style={{ borderTop: '1px solid #111e2d', marginBottom: 8 }} />
              {regularTasks.map((tk, i) => (
                <Bar key={tk.taskId} label={tk.taskName} value={tk.progress} status={tk.status} color={BAR_COLORS[i % BAR_COLORS.length]} tWbs={tWbs} t={t} />
              ))}
            </>
          )}

          <BimPredictionSection bimTasks={bimTasks} workers={workers} equipment={equipment} t={t} />
        </>
      )}
    </div>
  );
}
