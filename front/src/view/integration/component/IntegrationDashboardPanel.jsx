import { useIntegration } from '../IntegrationStore';
import { useT } from '../../../i18n/LanguageContext';

function StatCard({ label, value, unit, color, icon }) {
  return (
    <div style={{
      background: '#0d1b2a',
      border: `1px solid ${color}35`,
      borderRadius: 8,
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
    }}>
      <div style={{ fontSize: 10, color: '#8896a4', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>{icon}</span> {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>
        {value}
        <span style={{ fontSize: 11, fontWeight: 400, color: '#6b7280', marginLeft: 3 }}>
          {unit}
        </span>
      </div>
    </div>
  );
}

export default function IntegrationDashboardPanel() {
  const t = useT('integrationProject');
  const { workers, equipment, events, wbsProgress } = useIntegration();

  const workerCount    = workers.length;
  const equipCount     = equipment.filter(e => e.speed > 0).length;
  const eventCount     = events.length;
  const collisions     = events.filter(e => e.type === 'collision_risk').length;
  const zoneViolations = events.filter(e => e.type === 'zone_violation').length;
  const overall        = Math.round(wbsProgress.overall);

  return (
    <div style={{ padding: '12px 12px 8px' }}>
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        color: '#4b5563',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        marginBottom: 8,
      }}>
        {t('dashTitle')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        <StatCard label={t('statWorkers')}       value={workerCount}    unit="👷" color="#22c55e" icon="👷" />
        <StatCard label={t('statEquip')}          value={equipCount}     unit="🚜" color="#3b82f6" icon="🚜" />
        <StatCard label={t('statEvents')}         value={eventCount}     unit="⚠"  color="#f59e0b" icon="⚠" />
        <StatCard label={t('statProgress')}       value={overall}        unit="%"  color="#60a5fa" icon="📊" />
        <StatCard label={t('statCollisions')}     value={collisions}     unit="🚨" color="#ef4444" icon="🚨" />
        <StatCard label={t('statZoneViolations')} value={zoneViolations} unit="🔴" color="#a855f7" icon="🔴" />
      </div>
    </div>
  );
}
