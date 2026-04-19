/**
 * Alarms — full alarm log with filters and inline Ack / Clear actions.
 * Receives live new-alarm pushes via Socket.io.
 * Dark-themed using CSS variable palette.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alarms as AlarmsApi } from '../services/api';
import { useLiveFeed } from '../services/websocket';
import { useAuth } from '../contexts/AuthContext';

/* Severity → badge class */
const sevClass = (sev) => {
  const map = {
    low:      'badge idle',
    info:     'badge info',
    medium:   'badge warn',
    warning:  'badge warn',
    high:     'badge fatal',
    fatal:    'badge bad',
    critical: 'badge bad',
  };
  return map[sev] || 'badge idle';
};

/* Row left-border color per severity */
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

/* Row background tint */
const sevBg = (sev) => {
  const map = {
    fatal: 'rgba(224,90,90,.05)', critical: 'rgba(224,90,90,.05)',
    high: 'rgba(242,148,90,.04)',
    warning: 'rgba(232,199,112,.04)', medium: 'rgba(232,199,112,.04)',
  };
  return map[sev] || 'transparent';
};

export default function Alarms() {
  const [items, setItems]       = useState([]);
  const [status, setStatus]     = useState('active');
  const [severity, setSeverity] = useState('');
  const [error, setError]       = useState('');
  const { can } = useAuth();
  const { latestAlarm } = useLiveFeed({});

  const load = useCallback(async () => {
    try {
      const d = await AlarmsApi.list({
        status:   status   || undefined,
        severity: severity || undefined,
        limit: 200,
      });
      setItems(d.items || d);
      setError('');
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load alarms');
    }
  }, [status, severity]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (latestAlarm) load(); }, [latestAlarm, load]);

  const act = async (fn, id) => {
    try { await fn(id); load(); }
    catch (e) { setError(e.response?.data?.message || 'Action failed'); }
  };

  /* Severity counts for summary */
  const critCount = items.filter(a => ['fatal', 'critical', 'high'].includes(a.severity)).length;
  const warnCount = items.filter(a => ['medium', 'warning'].includes(a.severity)).length;

  return (
    <div>
      {/* Page head */}
      <div className="page-head">
        <div>
          <h2>Alarms</h2>
          <div style={{ fontSize: 11.5, color: 'var(--tm)', marginTop: 2 }}>
            {items.length} total ·
            {critCount > 0 && <span style={{ color: 'var(--red)', marginLeft: 6 }}>{critCount} critical/high</span>}
            {warnCount > 0 && <span style={{ color: 'var(--yellow)', marginLeft: 6 }}>{warnCount} warning</span>}
            {items.length === 0 && <span style={{ color: 'var(--g)', marginLeft: 6 }}>All clear</span>}
          </div>
        </div>

        {/* Filters */}
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
            <option value="fatal">Fatal</option>
          </select>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="panel">
        <div className="panel-head">
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: critCount > 0 ? 'var(--red)' : items.length > 0 ? 'var(--yellow)' : 'var(--g)',
            boxShadow: critCount > 0 ? '0 0 6px rgba(224,90,90,.5)' : 'none',
          }} />
          <span className="title">Alarm Log</span>
          <span className="menu">⋯</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Equipment</th>
                <th>Sensor</th>
                <th>Message</th>
                <th>Status</th>
                <th>Opened</th>
                <th>Closed</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(a => (
                <tr key={a.id} style={{ background: sevBg(a.severity), borderLeft: `3px solid ${sevBorder(a.severity)}` }}>
                  <td><span className={sevClass(a.severity)}>{a.severity}</span></td>
                  <td><code style={{ fontSize: 11 }}>{a.equipment_tag || '—'}</code></td>
                  <td><code style={{ fontSize: 11 }}>{a.sensor_tag || '—'}</code></td>
                  <td style={{ maxWidth: 260, fontSize: 12 }}>{a.message}</td>
                  <td>
                    <span className={`badge ${
                      a.status === 'active' ? 'bad' : a.status === 'acknowledged' ? 'warn' : 'idle'
                    }`}>
                      {a.status}
                    </span>
                  </td>
                  <td style={{ color: 'var(--tm)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                    {new Date(a.opened_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ color: 'var(--td)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                    {a.closed_at
                      ? new Date(a.closed_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {can('alarms', 'u') && a.status !== 'cleared' && (
                      <>
                        {a.status === 'active' && (
                          <button className="ghost small" style={{ marginRight: 4 }}
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
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: 28, color: 'var(--tm)', fontSize: 13 }}>
                    {status === 'active' ? '✓ No active alarms — plant operating normally' : 'No alarms match the filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
