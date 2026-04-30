/**
 * Alarms — full alarm log with filters, inline Ack/Clear actions,
 * and an expandable detail panel per alarm row.
 *
 * The detail panel can also be opened directly via /alarms/:id (deep-link)
 * — the row scrolls into view and expands automatically. Live new-alarm
 * pushes via Socket.io trigger a list reload.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alarms as AlarmsApi } from '../services/api';
import { useLiveFeed } from '../services/websocket';
import { useAuth } from '../contexts/AuthContext';
import TableSearch, { useTableSearch, NoResultsRow } from '../components/TableSearch';

/* ── Severity helpers ───────────────────────────────────────────── */
const sevClass = (sev) => {
  const map = { low: 'badge idle', info: 'badge info', medium: 'badge warn',
    warning: 'badge warn', high: 'badge fatal', fatal: 'badge bad', critical: 'badge bad' };
  return map[sev] || 'badge idle';
};
const sevBorder = (sev) => {
  const map = { fatal: 'var(--red)', critical: 'var(--red)', high: 'var(--orange)',
    warning: 'var(--yellow)', medium: 'var(--yellow)', info: 'var(--cyan)', low: 'transparent' };
  return map[sev] || 'transparent';
};
const sevBg = (sev) => {
  const map = { fatal: 'rgba(224,90,90,.05)', critical: 'rgba(224,90,90,.05)',
    high: 'rgba(242,148,90,.04)', warning: 'rgba(232,199,112,.04)', medium: 'rgba(232,199,112,.04)' };
  return map[sev] || 'transparent';
};
const sevColor = (sev) => {
  const map = { fatal: '#d64545', critical: '#d64545', high: '#e88a3a',
    warning: '#d4b13c', medium: '#d4b13c', info: '#2aa3b0', low: '#a8b9b0' };
  return map[sev] || '#a8b9b0';
};

/* ── Alarm detail panel ─────────────────────────────────────────── */
function AlarmDetail({ alarm, onClose, onAck, onClear, canEdit }) {
  const sev = alarm.severity || 'low';
  const duration = alarm.closed_at
    ? Math.round((new Date(alarm.closed_at) - new Date(alarm.opened_at)) / 60000)
    : Math.round((Date.now() - new Date(alarm.opened_at)) / 60000);

  return (
    <tr>
      <td colSpan="8" style={{ padding: 0, borderTop: 'none' }}>
        <div style={{
          background: '#f7faf8',
          border: `1px solid ${sevColor(sev)}44`,
          borderLeft: `4px solid ${sevColor(sev)}`,
          borderRadius: '0 0 6px 6px',
          margin: '0 0 2px 0',
          padding: '16px 20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr) auto',
          gap: '16px 24px',
        }}>
          {/* Column 1 — Identity */}
          <div>
            <div style={{ fontSize: 10, color: 'var(--td)', textTransform: 'uppercase', letterSpacing: .6, marginBottom: 10, fontWeight: 700 }}>
              Alarm Identity
            </div>
            <DetailRow label="ID"        value={`#${alarm.id}`} mono />
            <DetailRow label="Equipment" value={alarm.equipment_tag || '—'} mono />
            <DetailRow label="Sensor"    value={alarm.sensor_tag    || '—'} mono />
            <DetailRow label="Severity"  value={<span className={sevClass(sev)}>{sev}</span>} />
            <DetailRow label="Status"    value={
              <span className={`badge ${alarm.status === 'active' ? 'bad' : alarm.status === 'acknowledged' ? 'warn' : 'idle'}`}>
                {alarm.status}
              </span>
            } />
          </div>

          {/* Column 2 — Event details */}
          <div>
            <div style={{ fontSize: 10, color: 'var(--td)', textTransform: 'uppercase', letterSpacing: .6, marginBottom: 10, fontWeight: 700 }}>
              Event Details
            </div>
            <div style={{ fontSize: 12.5, color: '#102818', marginBottom: 10, lineHeight: 1.5 }}>
              {alarm.message}
            </div>
            {alarm.threshold_value != null && (
              <DetailRow label="Threshold"    value={Number(alarm.threshold_value).toFixed(3)} mono />
            )}
            {alarm.sensor_value != null && (
              <DetailRow label="Sensor value" value={
                <span style={{ color: sevColor(sev), fontWeight: 700 }}>
                  {Number(alarm.sensor_value).toFixed(3)}
                </span>
              } mono />
            )}
            {alarm.rule_name && (
              <DetailRow label="Rule" value={alarm.rule_name} />
            )}
          </div>

          {/* Column 3 — Timeline */}
          <div>
            <div style={{ fontSize: 10, color: 'var(--td)', textTransform: 'uppercase', letterSpacing: .6, marginBottom: 10, fontWeight: 700 }}>
              Timeline
            </div>
            <DetailRow label="Opened"
              value={new Date(alarm.opened_at).toLocaleString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })} mono />
            {alarm.acknowledged_at && (
              <DetailRow label="Acked"
                value={new Date(alarm.acknowledged_at).toLocaleString('en-GB', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                })} mono />
            )}
            {alarm.closed_at && (
              <DetailRow label="Closed"
                value={new Date(alarm.closed_at).toLocaleString('en-GB', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                })} mono />
            )}
            <DetailRow label="Duration"
              value={duration < 60
                ? `${duration} min`
                : `${Math.floor(duration / 60)}h ${duration % 60}m`}
            />
            {alarm.acknowledged_by && (
              <DetailRow label="Acked by" value={alarm.acknowledged_by} />
            )}
            {alarm.cleared_by && (
              <DetailRow label="Cleared by" value={alarm.cleared_by} />
            )}
          </div>

          {/* Actions column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'flex-start', alignItems: 'flex-end', minWidth: 100 }}>
            <button onClick={onClose} style={{
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 5, padding: '4px 10px',
              fontSize: 11.5, cursor: 'pointer', color: 'var(--tm)',
            }}>✕ Close</button>

            <button
              onClick={() => {
                const url = `${window.location.origin}/alarms/${alarm.id}`;
                if (navigator.clipboard) navigator.clipboard.writeText(url);
              }}
              title="Copy permalink"
              style={{
                background: '#fff', border: '1px solid var(--border)',
                borderRadius: 5, padding: '4px 10px',
                fontSize: 11.5, cursor: 'pointer', color: 'var(--tm)',
              }}>
              🔗 Copy link
            </button>

            {canEdit && alarm.status !== 'cleared' && (
              <>
                {alarm.status === 'active' && (
                  <button onClick={onAck} style={{
                    background: '#fff7e0', border: '1px solid var(--yellow)',
                    borderRadius: 5, padding: '5px 12px',
                    fontSize: 11.5, cursor: 'pointer', color: '#c09020', fontWeight: 600,
                  }}>✓ Acknowledge</button>
                )}
                <button onClick={onClear} style={{
                  background: '#e8f5ee', border: '1px solid var(--g)',
                  borderRadius: 5, padding: '5px 12px',
                  fontSize: 11.5, cursor: 'pointer', color: 'var(--g)', fontWeight: 600,
                }}>✓ Clear Alarm</button>
              </>
            )}

            {alarm.notes && (
              <div style={{
                marginTop: 8, fontSize: 11.5, color: 'var(--tm)', maxWidth: 160,
                background: '#fff', border: '1px solid var(--border)',
                borderRadius: 4, padding: '6px 8px', lineHeight: 1.4,
              }}>
                📝 {alarm.notes}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

/* Small label-value row inside detail panel */
function DetailRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, fontSize: 11.5 }}>
      <span style={{ color: 'var(--td)', minWidth: 80, flexShrink: 0 }}>{label}</span>
      {mono
        ? <code style={{ color: 'var(--tm)', fontSize: 11 }}>{value}</code>
        : <span>{value}</span>
      }
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────── */
export default function Alarms() {
  const [items, setItems]         = useState([]);
  // Default to 'all' so users see the full backfilled history (15/04/2026 → now)
  const [status, setStatus]       = useState('');
  const [severity, setSeverity]   = useState('');
  const [error, setError]         = useState('');
  const [search, setSearch]       = useState('');
  const [expandedId, setExpandedId] = useState(null); // which alarm row is expanded
  const { can } = useAuth();
  const { latestAlarm } = useLiveFeed({});
  const { id: deepLinkId } = useParams();
  const navigate = useNavigate();
  const rowRefs = useRef({});

  const load = useCallback(async () => {
    try {
      const d = await AlarmsApi.list({
        status:   status   || undefined,
        severity: severity || undefined,
        limit: 500,
      });
      setItems(d.items || d);
      setError('');
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load alarms');
    }
  }, [status, severity]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (latestAlarm) load(); }, [latestAlarm, load]);

  /* Deep-link: /alarms/:id auto-expands the matching row. Runs once when
     the URL parameter changes; the missing-row fetch is one-shot per id. */
  useEffect(() => {
    if (!deepLinkId) return;
    const idNum = Number(deepLinkId);
    if (!Number.isFinite(idNum)) return;
    setExpandedId(idNum);

    // Fire-and-forget: if the alarm isn't in the current filter view,
    // pull it directly so the user always sees the linked alarm.
    AlarmsApi.get(idNum)
      .then(a => setItems(prev =>
        prev.some(p => p.id === a.id) ? prev : [a, ...prev]
      ))
      .catch(() => setError(`Alarm #${idNum} not found`));

    // Scroll into view once the row is mounted
    const t = setTimeout(() => {
      const node = rowRefs.current[idNum];
      if (node && node.scrollIntoView) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [deepLinkId]);

  const act = async (fn, id) => {
    try { await fn(id); load(); setExpandedId(null); }
    catch (e) { setError(e.response?.data?.message || 'Action failed'); }
  };

  const toggleExpand = (id) => {
    setExpandedId(prev => {
      const next = prev === id ? null : id;
      // Keep the URL in sync so the user can copy/paste a deep link
      if (next) navigate(`/alarms/${id}`, { replace: true });
      else      navigate('/alarms',       { replace: true });
      return next;
    });
  };

  /* Severity counts for summary */
  const critCount = items.filter(a => ['fatal', 'critical', 'high'].includes(a.severity)).length;
  const warnCount = items.filter(a => ['medium', 'warning'].includes(a.severity)).length;

  /* Real-time search across the most useful alarm fields. */
  const filtered = useTableSearch(items, search, [
    'message', 'severity', 'status',
    'equipment_tag', 'equipment_name',
    'sensor_tag', 'sensor_name',
    'rule_name', 'rule_code',
  ]);

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
            {expandedId && <span style={{ color: 'var(--cyan)', marginLeft: 10 }}>· Alarm #{expandedId} expanded</span>}
          </div>
        </div>

        {/* Filters + search */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <TableSearch
            value={search}
            onChange={setSearch}
            total={items.length}
            shown={filtered.length}
            placeholder="Search alarms…"
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="cleared">Cleared</option>
          </select>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All severities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="urgent">Urgent</option>
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
          <span style={{ fontSize: 10.5, color: 'var(--td)', marginLeft: 4 }}>
            Click a row to view details
          </span>
          <span className="menu">⋯</span>
        </div>
        <div className="tbl-wrap" style={{ maxHeight: 580, overflowY: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>Severity</th>
                <th>Equipment</th>
                <th>Sensor</th>
                <th>Message</th>
                <th>Status</th>
                <th>Opened</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => {
                const isOpen = expandedId === a.id;
                return (
                  <Fragment key={a.id}>
                    <tr
                      ref={el => { rowRefs.current[a.id] = el; }}
                      onClick={() => toggleExpand(a.id)}
                      style={{
                        background: isOpen ? '#eaf4ee' : sevBg(a.severity),
                        borderLeft: `3px solid ${sevBorder(a.severity)}`,
                        cursor: 'pointer',
                        transition: 'background .15s',
                      }}
                    >
                      {/* Expand chevron */}
                      <td style={{ width: 24, color: 'var(--td)', fontSize: 10, userSelect: 'none' }}>
                        {isOpen ? '▼' : '▶'}
                      </td>
                      <td><span className={sevClass(a.severity)}>{a.severity}</span></td>
                      <td><code style={{ fontSize: 11 }}>{a.equipment_tag || '—'}</code></td>
                      <td><code style={{ fontSize: 11 }}>{a.sensor_tag || '—'}</code></td>
                      <td style={{ maxWidth: 240, fontSize: 12 }}>{a.message}</td>
                      <td>
                        <span className={`badge ${
                          a.status === 'active' ? 'bad' : a.status === 'acknowledged' ? 'warn' : 'idle'
                        }`}>
                          {a.status}
                        </span>
                      </td>
                      <td style={{ color: 'var(--tm)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                        {new Date(a.opened_at).toLocaleString('en-GB', {
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                        <button className="ghost small" style={{ marginRight: 4 }}
                          title="View full details"
                          onClick={() => toggleExpand(a.id)}>
                          {isOpen ? '▼ Hide' : '👁 Details'}
                        </button>
                        {can('alarms', 'w') && a.status !== 'cleared' && (
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

                    {/* Inline detail panel when row is expanded */}
                    {isOpen && (
                      <AlarmDetail
                        alarm={a}
                        onClose={() => { setExpandedId(null); navigate('/alarms', { replace: true }); }}
                        onAck={() => act(AlarmsApi.ack, a.id)}
                        onClear={() => act(AlarmsApi.clear, a.id)}
                        canEdit={can('alarms', 'w')}
                      />
                    )}
                  </Fragment>
                );
              })}
              {!items.length && (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: 28, color: 'var(--tm)', fontSize: 13 }}>
                    {status === 'active' ? '✓ No active alarms — plant operating normally' : 'No alarms match the filter.'}
                  </td>
                </tr>
              )}
              {items.length > 0 && filtered.length === 0 && (
                <NoResultsRow colSpan={8} query={search} />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
