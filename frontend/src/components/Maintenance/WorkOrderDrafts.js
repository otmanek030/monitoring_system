/**
 * WorkOrderDrafts — list of auto-generated draft work orders awaiting
 * supervisor approval.
 *
 * Sits at the top of the /maintenance page. Each draft shows the predicted
 * failure mode, urgency, and the recommended action + parts. Supervisors get
 * one-click "Approve" (creates a real maintenance_orders row) or "Reject"
 * (with optional reason). Auto-generation can also be triggered manually
 * from the toolbar to scan the most recent ML predictions.
 */
import React, { useEffect, useState } from 'react';
import { WorkOrders } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

const URGENCY_STYLE = {
  critical: { bg: '#fde0e0', col: '#b03333', label: 'CRITICAL' },
  urgent:   { bg: '#fde4d3', col: '#c75e1f', label: 'URGENT'   },
  high:     { bg: '#fdf3da', col: '#a07910', label: 'HIGH'     },
  normal:   { bg: '#e6f1ea', col: '#36764e', label: 'NORMAL'   },
  low:      { bg: '#eef2f0', col: '#5a6f64', label: 'LOW'      },
};

export default function WorkOrderDrafts({ onConverted }) {
  const [drafts,    setDrafts]    = useState([]);
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [busy,      setBusy]      = useState(null);    // ID currently being acted on
  const [scanning,  setScanning]  = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const { can } = useAuth();
  const canApprove = can('work_orders', 'w');

  const load = async () => {
    setLoading(true);
    try {
      const r = await WorkOrders.list({ status: 'pending' });
      setDrafts(Array.isArray(r) ? r : (r.items || []));
      setError('');
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const scan = async () => {
    if (!canApprove) return;
    setScanning(true);
    try {
      const r = await WorkOrders.autoGenerate();
      if (r.n_created > 0) {
        await load();
      } else if (r.n_skipped > 0) {
        // briefly surface the message so the user knows nothing changed
        setError(`Scan complete — ${r.n_skipped} drafts already pending, nothing new.`);
        setTimeout(() => setError(''), 4000);
      } else {
        setError('Scan complete — no equipment currently above the alert thresholds.');
        setTimeout(() => setError(''), 4000);
      }
    } catch (e) {
      setError(e.response?.data?.message || 'Auto-generate failed');
    } finally {
      setScanning(false);
    }
  };

  const approve = async (d) => {
    setBusy(d.work_order_id);
    try {
      await WorkOrders.approve(d.work_order_id);
      await load();
      if (onConverted) onConverted();
    } catch (e) {
      setError(e.response?.data?.message || 'Approval failed');
    } finally { setBusy(null); }
  };

  const reject = async () => {
    if (!rejectFor) return;
    setBusy(rejectFor.work_order_id);
    try {
      await WorkOrders.reject(rejectFor.work_order_id, rejectReason);
      setRejectFor(null);
      setRejectReason('');
      await load();
    } catch (e) {
      setError(e.response?.data?.message || 'Reject failed');
    } finally { setBusy(null); }
  };

  if (drafts.length === 0 && !error) {
    // Hidden when there's nothing to show (but still expose the scan button)
    return (
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-head">
          <span className="title">Auto-Generated Work Order Drafts</span>
          <span style={{ fontSize: 10.5, color: 'var(--td)', marginLeft: 4 }}>
            none pending
          </span>
          {canApprove && (
            <button
              onClick={scan}
              disabled={scanning}
              className="ghost"
              style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 10px' }}
              title="Scan latest ML predictions and create drafts"
            >
              {scanning ? 'Scanning…' : '⟳ Scan ML predictions'}
            </button>
          )}
        </div>
      </div>
    );
  }

  const counts = {
    critical: drafts.filter(d => d.urgency === 'critical').length,
    urgent:   drafts.filter(d => d.urgency === 'urgent').length,
    other:    drafts.filter(d => !['critical','urgent'].includes(d.urgency)).length,
  };

  return (
    <div className="panel" style={{ marginBottom: 12, borderTop: '3px solid var(--g)' }}>
      <div className="panel-head" style={{ cursor: 'pointer' }} onClick={() => setCollapsed(c => !c)}>
        <span className="title">⚡ Auto-Generated Work Order Drafts</span>
        <span style={{
          marginLeft: 8, fontSize: 10.5,
          padding: '1px 8px', borderRadius: 10,
          background: drafts.length > 0 ? '#fdf3da' : '#e6f1ea',
          color: drafts.length > 0 ? '#a07910' : '#36764e',
          fontWeight: 700,
        }}>
          {drafts.length} pending
        </span>
        {counts.critical > 0 && (
          <span style={{ fontSize: 10.5, color: '#b03333', marginLeft: 6 }}>
            · {counts.critical} critical
          </span>
        )}
        {counts.urgent > 0 && (
          <span style={{ fontSize: 10.5, color: '#c75e1f', marginLeft: 6 }}>
            · {counts.urgent} urgent
          </span>
        )}
        {canApprove && (
          <button
            onClick={(e) => { e.stopPropagation(); scan(); }}
            disabled={scanning}
            className="ghost"
            style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 10px' }}
          >
            {scanning ? 'Scanning…' : '⟳ Scan now'}
          </button>
        )}
        <span className="menu" style={{ marginLeft: 6 }}>{collapsed ? '▸' : '▾'}</span>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', fontSize: 11.5, color: '#7a4a10', background: '#fdf3da', borderBottom: '1px solid var(--border)' }}>
          {error}
        </div>
      )}

      {!collapsed && (
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {drafts.map(d => {
            const u = URGENCY_STYLE[d.urgency] || URGENCY_STYLE.normal;
            const acting = busy === d.work_order_id;
            return (
              <div key={d.work_order_id} style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--border)',
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 10,
                background: d.urgency === 'critical' ? 'rgba(176,51,51,.04)' : 'transparent',
              }}>
                {/* Left: text */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{
                      background: u.bg, color: u.col,
                      padding: '1px 7px', borderRadius: 3,
                      fontSize: 9.5, fontWeight: 700, letterSpacing: .4,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {u.label}
                    </span>
                    <code style={{ fontSize: 11, color: 'var(--g)', fontWeight: 700 }}>
                      {d.equipment_tag}
                    </code>
                    <span style={{ color: 'var(--td)', fontSize: 10.5 }}>
                      {d.equipment_name}
                    </span>
                    {d.failure_probability != null && (
                      <span style={{ fontSize: 10.5, color: 'var(--tm)', fontFamily: "'JetBrains Mono', monospace" }}>
                        · prob {Math.round(d.failure_probability * 100)}%
                      </span>
                    )}
                    {d.rul_hours != null && (
                      <span style={{ fontSize: 10.5, color: 'var(--tm)', fontFamily: "'JetBrains Mono', monospace" }}>
                        · RUL {Math.round(d.rul_hours)}h
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--td)', marginLeft: 'auto' }}>
                      {new Date(d.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)', marginBottom: 3 }}>
                    {d.title}
                  </div>
                  {d.recommended_action && (
                    <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 3, lineHeight: 1.4 }}>
                      <strong style={{ color: 'var(--tx)' }}>Action: </strong>{d.recommended_action}
                    </div>
                  )}
                  {d.suggested_parts && (
                    <div style={{ fontSize: 11, color: 'var(--tm)', lineHeight: 1.4 }}>
                      <strong style={{ color: 'var(--tx)' }}>Parts: </strong>{d.suggested_parts}
                    </div>
                  )}
                </div>

                {/* Right: actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch', minWidth: 130 }}>
                  {canApprove ? (
                    <>
                      <button
                        className="primary"
                        disabled={acting}
                        onClick={() => approve(d)}
                        style={{ fontSize: 11, padding: '5px 10px' }}
                      >
                        {acting ? '…' : '✓ Approve'}
                      </button>
                      <button
                        className="ghost"
                        disabled={acting}
                        onClick={() => { setRejectFor(d); setRejectReason(''); }}
                        style={{ fontSize: 11, padding: '5px 10px' }}
                      >
                        ✕ Reject
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: 10, color: 'var(--td)', textAlign: 'center', padding: '4px 0' }}>
                      Awaiting supervisor
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reject modal */}
      {rejectFor && (
        <div className="modal-backdrop" onClick={() => setRejectFor(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h3 style={{ marginTop: 0 }}>Reject draft</h3>
            <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 10 }}>
              {rejectFor.equipment_tag} — {rejectFor.title}
            </div>
            <textarea
              autoFocus
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason (optional) — e.g. false positive, already scheduled"
              rows={3}
              style={{ width: '100%', fontSize: 12, padding: 8 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <button className="ghost" onClick={() => setRejectFor(null)}>Cancel</button>
              <button className="primary" onClick={reject} disabled={busy === rejectFor.work_order_id}>
                Reject draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
