/**
 * Compact table of active / recent alarms.
 * Supports in-line Ack + Clear buttons (permission-gated).
 */
import { useAuth } from '../../contexts/AuthContext';
import { Alarms } from '../../services/api';

// Map DB severity names ('warning', 'fatal') plus legacy aliases to badge styles.
const pill = (sev) => {
  const colors = {
    low:      { bg: '#2a3a55', fg: '#9fb6d9' },
    info:     { bg: '#2a3a55', fg: '#9fb6d9' },
    warning:  { bg: '#4a3a1a', fg: '#ffb04a' },
    medium:   { bg: '#4a3a1a', fg: '#ffb04a' },
    high:     { bg: '#5a2b1a', fg: '#ff8e5c' },
    fatal:    { bg: '#5a1a20', fg: '#ff5566' },
    critical: { bg: '#5a1a20', fg: '#ff5566' },
  };
  const c = colors[sev] || colors.low;
  return { background: c.bg, color: c.fg };
};

export default function AlertsPanel({ alarms = [], onRefresh }) {
  const { can } = useAuth();

  const act = async (fn, id) => {
    try { await fn(id); onRefresh && onRefresh(); }
    catch (e) { console.error(e); }
  };

  if (!alarms.length) {
    return (
      <div className="card">
        <div className="card-head"><strong>Active alarms</strong></div>
        <div className="muted" style={{ padding: 20, textAlign: 'center' }}>
          No active alarms. Plant operating normally.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <strong>Active alarms</strong>
        <span className="muted" style={{ fontSize: 12 }}>{alarms.length} open</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Tag</th>
              <th>Message</th>
              <th>Opened</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {alarms.slice(0, 15).map(a => (
              <tr key={a.id}>
                <td><span className="badge" style={pill(a.severity)}>{a.severity}</span></td>
                <td><code>{a.sensor_tag || a.equipment_tag || '--'}</code></td>
                <td>{a.message}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {new Date(a.opened_at).toLocaleString()}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {!a.acknowledged_at && can('alarms', 'u') && (
                    <button className="ghost small"
                            onClick={() => act(Alarms.ack, a.id)}>Ack</button>
                  )}
                  {can('alarms', 'u') && (
                    <button className="ghost small"
                            onClick={() => act(Alarms.clear, a.id)}>Clear</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
