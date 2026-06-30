import { useIntegration } from '../IntegrationStore';
import { useT, useLanguage } from '../../../i18n/LanguageContext';

const SEV_COLOR = { critical: '#ef4444', warning: '#f59e0b', info: '#60a5fa' };
const TYPE_ICON  = {
  collision_risk: '🚨',
  zone_violation: '⚠',
  no_gear:        '🦺',
  info:           'ℹ',
};

function EventRow({ event }) {
  const { lang } = useLanguage();
  const time  = new Date(event.timestamp).toLocaleTimeString(lang, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const color = SEV_COLOR[event.severity] || '#8896a4';
  const icon  = TYPE_ICON[event.type] || '•';

  return (
    <div style={{
      display: 'flex',
      gap: 7,
      padding: '6px 10px',
      borderBottom: '1px solid #111e2d',
      alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10,
          color,
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {event.description}
        </div>
        <div style={{ fontSize: 9, color: '#374151', marginTop: 1 }}>{time}</div>
      </div>
      <span style={{
        fontSize: 8,
        color,
        background: `${color}20`,
        border: `1px solid ${color}40`,
        borderRadius: 3,
        padding: '1px 4px',
        flexShrink: 0,
        alignSelf: 'center',
        fontWeight: 700,
      }}>
        {event.severity?.toUpperCase()}
      </span>
    </div>
  );
}

export default function IntegrationEventLog() {
  const t = useT('integrationProject');
  const { events } = useIntegration();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{
        padding: '7px 12px',
        fontSize: 10,
        fontWeight: 700,
        color: '#4b5563',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        borderBottom: '1px solid #111e2d',
        flexShrink: 0,
      }}>
        {t('eventLogTitle')} ({events.length})
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {events.length === 0 ? (
          <div style={{
            padding: 20,
            color: '#374151',
            fontSize: 11,
            textAlign: 'center',
          }}>
            {t('noEvents')}
          </div>
        ) : (
          events.map(ev => <EventRow key={ev.id} event={ev} />)
        )}
      </div>
    </div>
  );
}
