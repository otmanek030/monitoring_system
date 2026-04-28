/**
 * AlertsPanel — dark-themed table of active / recent alarms.
 * Color-coded severity rows. Ack / Clear buttons for authorized roles.
 */
import { useAuth } from '../../contexts/AuthContext';
import { Alarms } from '../../services/api';

/* Severity → CSS var mapping */
const sevStyle = (sev) => {
  const map = {
    low:      { color: 'var(--tm)',     bg: 'transparent' },
    info:     { color: 'var(--cyan)',   bg: 'rgba(94,200,209,.08)' },
    warning:  { color: 'var(--yellow)', bg: 'rgba(232,199,112,.06)' },
    medium:   { color: 'var(--yellow)', bg: 'rgba(232,199,112,.06)' },
    high:     { color: 'var(--orange)', bg: 'rgba(242,148,90,.06)' },
    fatal:    { color: 'var(--red)',    bg: 'rgba(224,90,90,.08)' },
    critical: { color: 'var(--red)',    bg: 'rgba(224,90,90,.08)' },
  };
  return map[sev] || map.low;
};

const sevBadgeClass = (sev) => {
  const map = {
    low: 'badge idle', info: 'badge info',
    warning: 'badge warn', medium: 'badge warn',
    high: 'badge fatal', fatal: 'badge bad', critical: 'badge bad',
  };
  return map[sev] || 'badge idle';
};

/* Left-border color per severity */
const sevBorder = (sev) => {
  const map = {
    fatal: 'var(--red)', critical: 'var(--red)',
    high: 'var(--orange)',
    warning: 'var(--yellow)', medium: 'var(--yellow)',
    info: 'var(--cyan)',
    low: 'transparent',
  };
  return map[sev] || 'transparent';
};

export default function AlertsPanel({ alarms = [], onRefresh }) {
  const { can } = useAuth();

  const act = async (fn, id) => {
    try { await fn(id); onRefresh?.(); }
    catch (e) { console.error(e); }
  };

  return (
    <div className="panel">
      {/* Header */}
      <div className="panel-head">
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: alarms.length > 0 ? 'var(--red)' : 'var(--g)', flexShrink: 0, boxShadow: alarms.length > 0 ? '0 0 6px rgba(214,69,69,.5)' : '0 0 4px rgba(0,122,61,.4)' }} />
        <span className="title">Active Alarms</span>
        <span style={{ fontSize: 10.5, color: 'var(--tm)', marginLeft: 4 }}>
          {alarms.length > 0 ? `${alarms.length} open` : 'All clear'}
        </span>
        <span className="menu">⋯</span>
      </div>

      {/* Empty state */}
      {!alarms.length && (
        <div style={{ padding: '22px 16px', textAlign: 'center', color: 'var(--tm)', fontSize: 12.5 }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>✓</div>
          Plant operating normally — no active alarms
        </div>
      )}

      {/* Table */}
      {alarms.length > 0 && (
        <div className="tbl-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
          <table className="tbl">
            <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 2 }}>
              <tr>
                <th>Severity</th>
                <th>Tag</th>
                <th>Message</th>
                <th>Opened</th>
                <th>Ack</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {alarms.map(a => {
                const s = sevStyle(a.severity);
                return (
                  <tr key={a.id} style={{ background: s.bg, borderLeft: `3px solid ${sevBorder(a.severity)}` }}>
                    <td>
                      <span className={sevBadgeClass(a.severity)}>
                        {a.severity}
                      </span>
                    </td>
                    <td>
                      <code style={{ fontSize: 11 }}>
                        {a.sensor_tag || a.equipment_tag || '--'}
                      </code>
                    </td>
                    <td style={{ color: s.color, maxWidth: 280 }}>
                      {a.message}
                    </td>
                    <td style={{ color: 'var(--tm)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                      {new Date(a.opened_at).toLocaleString('en-GB', {
                        day: '2-digit', month: 'short',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td>
                      {a.acknowledged_at ? (
                        <span className="badge fern" style={{ fontSize: 9.5 }}>ACK</span>
                      ) : (
                        <span className="badge idle" style={{ fontSize: 9.5 }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {!a.acknowledged_at && can('alarms', 'u') && (
                        <button
                          className="ghost small"
                          onClick={() => act(Alarms.ack, a.id)}
                          style={{ marginRight: 4 }}
                        >
                          Ack
                        </button>
                      )}
                      {can('alarms', 'u') && (
                        <button className="ghost small" onClick={() => act(Alarms.clear, a.id)}>
                          Clear
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
