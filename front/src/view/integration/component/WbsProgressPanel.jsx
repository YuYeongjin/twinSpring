import { useMemo, useState } from 'react';
import { useIntegration } from '../IntegrationStore';
import { useT } from '../../../i18n/LanguageContext';
import { calcProgressRate, predictCompletion, getRecommendations } from '../progressEngine';

const TASK_STATUS_META = {
  NOT_STARTED: { labelKey: 'taskNotStarted', color: '#94a3b8' },
  IN_PROGRESS: { labelKey: 'taskInProgress', color: '#60a5fa' },
  COMPLETED:   { labelKey: 'taskCompleted',  color: '#4ade80' },
  DELAYED:     { labelKey: 'taskDelayed',    color: '#ef4444' },
};
const BAR_COLORS = ['#22c55e', '#f59e0b', '#3b82f6', '#a855f7', '#f97316', '#06b6d4'];

const ELEM_LABEL = {
  IfcSlab: '슬래브/기초', IfcColumn: '기둥',
  IfcBeam: '보',          IfcWall: '벽체', IfcPier: '교각',
};

const PROGRESS_COLOR = p =>
  p >= 100 ? '#60a5fa' : p >= 75 ? '#22c55e' : p >= 40 ? '#eab308' : p > 0 ? '#f97316' : '#1e3a5f';

function fmtDate(d) {
  if (!d) return '';
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}`;
}

// ── 일반 WBS 진도 바 ──────────────────────────────────────────
function Bar({ label, value, color, status, tWbs }) {
  const sm = TASK_STATUS_META[status];
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: '#8896a4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          {sm && <span style={{ fontSize: 8, color: sm.color, fontWeight: 700 }}>{tWbs(sm.labelKey) || sm.labelKey}</span>}
          <span style={{ fontSize: 10, fontWeight: 700, color }}>{Math.round(value ?? 0)}%</span>
        </div>
      </div>
      <div style={{ background: '#111e2d', borderRadius: 4, height: 5, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, value ?? 0)}%`, background: color, borderRadius: 4, transition: 'width 1.2s ease' }} />
      </div>
    </div>
  );
}

// ── BIM 공종 행 (클릭하면 추천 펼침) ─────────────────────────
function BimPredRow({ task, workers, equipment }) {
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

  // 오른쪽 상태 텍스트 (텍스트만, 박스 없음)
  let statusText, statusColor;
  if (progress >= 100) {
    statusText = '완료';       statusColor = '#60a5fa';
  } else if (blocked) {
    statusText = '차단됨';     statusColor = '#ef4444';
  } else if (!pred) {
    statusText = '—';          statusColor = '#374151';
  } else if (pred.isDelayed) {
    statusText = `${fmtDate(pred.predictedDate)} ↑${pred.delayDays}일`;
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
          cursor: recs.length > 0 ? 'pointer' : 'default',
          padding: 0, textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: '#8896a4', flexShrink: 0, width: 58, textAlign: 'left' }}>
            {ELEM_LABEL[elementType] || elementType}
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

      {/* 추천 목록 (펼침) */}
      {open && recs.length > 0 && (
        <div style={{ paddingLeft: 8, marginTop: 2, borderLeft: '1px solid #1e3a5f' }}>
          {recs.map((rec, i) => (
            <div key={i} style={{ fontSize: 9, color: '#6b7280', lineHeight: 1.6 }}>
              {rec.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── BIM 공정 예측 섹션 ───────────────────────────────────────
function BimPredictionSection({ bimTasks, workers, equipment }) {
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
          ⚡ BIM 공정 예측
        </span>
        <span style={{ fontSize: 9, color: '#374151' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && bimTasks.map(task => (
        <BimPredRow key={task.taskId} task={task} workers={workers} equipment={equipment} />
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
          <Bar label={t('wbsOverall')} value={overall} color="#60a5fa" tWbs={tWbs} />

          {regularTasks.length > 0 && (
            <>
              <div style={{ borderTop: '1px solid #111e2d', marginBottom: 8 }} />
              {regularTasks.map((tk, i) => (
                <Bar key={tk.taskId} label={tk.taskName} value={tk.progress} status={tk.status} color={BAR_COLORS[i % BAR_COLORS.length]} tWbs={tWbs} />
              ))}
            </>
          )}

          <BimPredictionSection bimTasks={bimTasks} workers={workers} equipment={equipment} />
        </>
      )}
    </div>
  );
}
