import { useIntegration } from '../IntegrationStore';
import { useT } from '../../../i18n/LanguageContext';

const TASK_STATUS_META = {
  NOT_STARTED: { labelKey: 'taskNotStarted', color: '#94a3b8' },
  IN_PROGRESS: { labelKey: 'taskInProgress', color: '#60a5fa' },
  COMPLETED:   { labelKey: 'taskCompleted',  color: '#4ade80' },
  DELAYED:     { labelKey: 'taskDelayed',    color: '#ef4444' },
};

const BAR_COLORS = ['#22c55e', '#f59e0b', '#3b82f6', '#a855f7', '#f97316', '#06b6d4'];

function Bar({ label, value, color, status, tWbs }) {
  const sm = TASK_STATUS_META[status];
  const statusLabel = sm ? (tWbs(sm.labelKey) || sm.labelKey) : null;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{
          fontSize: 10,
          color: '#8896a4',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 160,
        }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          {sm && (
            <span style={{ fontSize: 8, color: sm.color, fontWeight: 700 }}>{statusLabel}</span>
          )}
          <span style={{ fontSize: 10, fontWeight: 700, color }}>{Math.round(value ?? 0)}%</span>
        </div>
      </div>
      <div style={{ background: '#111e2d', borderRadius: 4, height: 5, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${Math.min(100, value ?? 0)}%`,
          background: color,
          borderRadius: 4,
          transition: 'width 1.2s ease',
        }} />
      </div>
    </div>
  );
}

export default function WbsProgressPanel() {
  const t    = useT('integrationProject');
  const tWbs = useT('wbs');
  const { wbsTasks, isLoading } = useIntegration();

  const overall = wbsTasks.length > 0
    ? Math.round(wbsTasks.reduce((s, tk) => s + (tk.progress || 0), 0) / wbsTasks.length)
    : 0;

  return (
    <div style={{
      padding: '10px 12px',
      borderTop: '1px solid #111e2d',
      flexShrink: 0,
      maxHeight: 240,
      overflowY: 'auto',
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        color: '#4b5563',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        marginBottom: 10,
      }}>
        {t('wbsProgressTitle')}
      </div>

      {isLoading && (
        <div style={{ color: '#374151', fontSize: 10, textAlign: 'center', padding: '8px 0' }}>
          {t('loading')}
        </div>
      )}

      {!isLoading && wbsTasks.length === 0 && (
        <div style={{ color: '#374151', fontSize: 10, textAlign: 'center', padding: '8px 0' }}>
          {t('wbsNoTasks')}
        </div>
      )}

      {!isLoading && wbsTasks.length > 0 && (
        <>
          <Bar label={t('wbsOverall')} value={overall} color="#60a5fa" tWbs={tWbs} />
          <div style={{ borderTop: '1px solid #111e2d', marginBottom: 8 }} />
          {wbsTasks.map((tk, i) => (
            <Bar
              key={tk.taskId}
              label={tk.taskName}
              value={tk.progress}
              status={tk.status}
              color={BAR_COLORS[i % BAR_COLORS.length]}
              tWbs={tWbs}
            />
          ))}
        </>
      )}
    </div>
  );
}
