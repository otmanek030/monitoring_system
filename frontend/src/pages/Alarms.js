/**
 * Full alarm log with filters (status, severity, date range) and inline
 * Ack / Clear actions. Receives live new-alarm pushes via Socket.io.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alarms as AlarmsApi } from '../services/api';
import { useLiveFeed } from '../services/websocket';
import { useAuth } from '../contexts/AuthContext';

const sevPill = (sev) => {
  const colors = {
    low:      { bg: '#2a3a55', fg: '#9fb6d9' },
    medium:   { bg: '#4a3a1a', fg: '#ffb04a' },
    high:     { bg: '#5a2b1a', fg: '#ff8e5c' },
    critical: { bg: '#5a1a20', fg: '#ff5566' },
  };
  const c = colors[sev] || colors.low;
  return { background: c.bg, color: c.fg };
};

export default function Alarms() {
  const [items, setItems] = useState([]);
  const [status,   setStatus]   = useState('active');
  const [severity, setSeverity] = useState('');
  const [error, setError] = useState('');
  const { can } = useAuth();

  const { latestAlarm } = useLiveFeed({});

  const load = useCallback(async () => {
    try {
      const d = await AlarmsApi.list({
        status: status || undefined,
        severity: severity || undefined,
        limit: 200,
      });
      setItems(d.items || d);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load');
    }
  }, [status, severity]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (latestAlarm) load(); }, [latestAlarm, load]);

  const act = async (fn, id) => {
    try { await fn(id); load(); }
    catch (e) { setError(e.response?.data?.message || 'Action failed'); }
  };

  return (
    <div>
      <div className="page-head">
        <h2>Alarms</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="cleared">Cleared</option>
          </select>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All severities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Severity</th><th>Equipment</th><th>Sensor</th><th>Message</th>
              <th>Status</th><th>Opened</th><th>Closed</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(a => (
              <tr key={a.id}>
                <td><span className="badge" style={sevPill(a.severity)}>{a.severity}</span></td>
                <td><code>{a.equipment_tag || '--'}</code></td>
                <td><code>{a.sensor_tag || '--'}</code></td>
                <td>{a.message}</td>
                <td className="muted">{a.status}</td>
                <td className="muted">{new Date(a.opened_at).toLocaleString()}</td>
                <td className="muted">{a.closed_at ? new Date(a.closed_at).toLocaleString() : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {can('alarms', 'u') && a.status !== 'cleared' && (
                    <>
                      {a.status === 'active' && (
                        <button className="ghost small"
                                onClick={() => act(AlarmsApi.ack, a.id)}>Ack</button>
                      )}
                      <button className="ghost small"
                              onClick={() => act(AlarmsApi.clear, a.id)}>Clear</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr><td colSpan="8" className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No alarms match the filter.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
