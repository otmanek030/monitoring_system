/**
 * Maintenance orders page — enhanced with inline notes/comments per order.
 *
 * Role-aware:
 *   - list/view        : maintenance:r (all roles)
 *   - create / update  : maintenance:w (technician+)
 *   - assign to tech   : assign_maintenance:w (supervisor+)
 *   - add notes        : maintenance:w (technician+) — stored in order.notes field
 *
 * New features:
 *   - Click a row to expand and see order details + add a note/comment
 *   - Notes appear in a scrollable panel below the row
 *   - Other users see a 💬 badge with note count
 */
import { useEffect, useState } from 'react';
import {
  Maintenance as MaintApi,
  Equipment   as EqApi,
  Users       as UsersApi,
} from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import TableSearch, { useTableSearch } from '../components/TableSearch';

const STATUSES = [
  { value: 'open',        label: 'Open',        cls: 'info' },
  { value: 'scheduled',   label: 'Scheduled',   cls: 'info' },
  { value: 'in_progress', label: 'In Progress', cls: 'warn' },
  { value: 'completed',   label: 'Completed',   cls: 'ok'   },
  { value: 'cancelled',   label: 'Cancelled',   cls: 'idle' },
];

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const PRIORITY_COLOR = { low: 'var(--td)', normal: 'var(--tm)', high: 'var(--yellow)', urgent: 'var(--red)' };
const ORDER_TYPES = ['preventive', 'corrective', 'predictive', 'inspection', 'calibration'];

function statusCls(s) { return STATUSES.find(x => x.value === s)?.cls || 'info'; }

export default function Maintenance() {
  const [items,       setItems]       = useState([]);
  const [equipment,   setEquipment]   = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [filter,      setFilter]      = useState('');     // status filter
  const [search,      setSearch]      = useState('');     // free-text search
  const [showNew,     setShowNew]     = useState(false);
  const [expanded,    setExpanded]    = useState(null);  // order_id of expanded row
  const [addingNote,  setAddingNote]  = useState(null);  // order_id being noted
  const [noteText,    setNoteText]    = useState('');
  const [error,       setError]       = useState('');
  const { can, user } = useAuth();

  const canWrite     = can('maintenance', 'w');
  const canAssign    = can('assign_maintenance', 'w');
  const canListUsers = user?.role === 'admin' || user?.role === 'supervisor';

  const load = () => {
    MaintApi.list({ limit: 200 })
      .then(d => setItems(d.items || d || []))
      .catch(e => setError(e.response?.data?.message || 'Failed to load orders'));
  };

  useEffect(() => {
    load();
    EqApi.list().then(d => setEquipment(d.items || d.equipment || d || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!canListUsers) return;
    UsersApi.list().then(d => {
      const all = d.items || d.users || d || [];
      setTechnicians(all.filter(u => u.is_active && ['technician', 'supervisor', 'admin'].includes(u.role)));
    }).catch(() => {});
  }, [canListUsers]);

  const changeStatus = async (id, status) => {
    try { await MaintApi.update(id, { status }); load(); }
    catch (e) { setError(e.response?.data?.message || 'Update failed'); }
  };

  const assignTo = async (id, val) => {
    try { await MaintApi.assign(id, val || null); load(); }
    catch (e) { setError(e.response?.data?.message || 'Assign failed'); }
  };

  /** Append a note to the order's notes field */
  const submitNote = async (orderId) => {
    if (!noteText.trim()) return;
    const order = items.find(m => (m.order_id || m.id) === orderId);
    if (!order) return;
    const timestamp = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const newLine   = `[${timestamp} — ${user?.username || 'user'}] ${noteText.trim()}`;
    const combined  = order.notes ? `${order.notes}\n${newLine}` : newLine;
    try {
      await MaintApi.update(orderId, { notes: combined });
      setNoteText('');
      setAddingNote(null);
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to add note');
    }
  };

  // Status filter first (server-side semantics), then free-text search.
  const byStatus = filter ? items.filter(i => i.status === filter) : items;
  const visible  = useTableSearch(byStatus, search, [
    'title', 'description', 'order_type', 'priority', 'status',
    'equipment_tag', 'equipment_name', 'assigned_username', 'created_by_username',
  ]);

  /* Count orders with notes for the header badge */
  const withNotes = items.filter(m => m.notes).length;

  return (
    <div>
      {/* ── Page head ── */}
      <div className="page-head">
        <div>
          <h2>Maintenance Orders</h2>
          <div style={{ fontSize: 11.5, color: 'var(--tm)', marginTop: 2 }}>
            {items.length} orders
            {withNotes > 0 && <span style={{ color: 'var(--cyan)', marginLeft: 6 }}>· {withNotes} with notes 💬</span>}
            {items.filter(m => m.status === 'open').length > 0 && (
              <span style={{ color: 'var(--yellow)', marginLeft: 6 }}>
                · {items.filter(m => m.status === 'open').length} open
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <TableSearch
            value={search}
            onChange={setSearch}
            total={byStatus.length}
            shown={visible.length}
            placeholder="Search title, equipment, assignee…"
          />
          <select value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {canWrite && (
            <button className="primary" onClick={() => setShowNew(true)}>+ New Order</button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="panel">
        <div className="tbl-wrap" style={{ maxHeight: 600, overflowY: 'auto' }}>
          <table className="tbl">
            <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 2 }}>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Equipment</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Assigned</th>
                <th>Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(m => {
                const oid = m.order_id || m.id;
                const isExpanded = expanded === oid;
                const noteLines = (m.notes || '').trim().split('\n').filter(Boolean);
                return (
                  <>
                    <tr
                      key={oid}
                      style={{
                        cursor: 'pointer',
                        background: isExpanded ? 'rgba(0,122,61,.04)' : undefined,
                        borderLeft: isExpanded ? '3px solid var(--g)' : '3px solid transparent',
                      }}
                      onClick={() => setExpanded(isExpanded ? null : oid)}
                    >
                      <td style={{ color: 'var(--td)', fontSize: 11 }}>#{oid}</td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{m.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--td)', textTransform: 'capitalize' }}>
                          {m.order_type}
                          {noteLines.length > 0 && (
                            <span style={{ marginLeft: 6, color: 'var(--cyan)' }}>
                              💬 {noteLines.length} note{noteLines.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </td>
                      <td><code style={{ fontSize: 11 }}>{m.equipment_tag || '—'}</code></td>
                      <td>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: PRIORITY_COLOR[m.priority] || 'var(--tm)' }}>
                          {m.priority}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${statusCls(m.status)}`}>{m.status}</span>
                      </td>
                      <td>
                        {canAssign ? (
                          <select
                            value={m.assigned_to || ''}
                            onChange={e => { e.stopPropagation(); assignTo(oid, e.target.value); }}
                            onClick={e => e.stopPropagation()}
                            style={{ fontSize: 11.5, minWidth: 130 }}
                          >
                            <option value="">— Unassigned —</option>
                            {technicians.map(t => (
                              <option key={t.id} value={t.id}>{t.username} ({t.role})</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                            {m.assigned_to_username || '—'}
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--td)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {new Date(m.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {canWrite && m.status !== 'completed' && (
                          <select
                            value={m.status}
                            onChange={e => { e.stopPropagation(); changeStatus(oid, e.target.value); }}
                            onClick={e => e.stopPropagation()}
                            style={{ fontSize: 11, width: 120 }}
                          >
                            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>

                    {/* Expanded detail row with notes */}
                    {isExpanded && (
                      <tr key={`${oid}-detail`}>
                        <td colSpan="8" style={{ padding: 0 }}>
                          <div style={{
                            background: 'rgba(0,122,61,.03)',
                            borderLeft: '3px solid var(--g)',
                            padding: '12px 16px',
                            borderTop: '1px solid var(--border)',
                          }}>
                            {/* Description */}
                            {m.description && (
                              <div style={{ marginBottom: 10 }}>
                                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>
                                  Description
                                </div>
                                <div style={{ fontSize: 12.5, color: 'var(--tx)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                                  {m.description}
                                </div>
                              </div>
                            )}

                            {/* Planned dates */}
                            {(m.planned_start || m.planned_end) && (
                              <div style={{ marginBottom: 10, display: 'flex', gap: 16 }}>
                                {m.planned_start && (
                                  <div>
                                    <span style={{ fontSize: 10.5, color: 'var(--td)' }}>Planned start: </span>
                                    <span style={{ fontSize: 11.5, color: 'var(--tm)', fontFamily: "'JetBrains Mono', monospace" }}>
                                      {new Date(m.planned_start).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                )}
                                {m.planned_end && (
                                  <div>
                                    <span style={{ fontSize: 10.5, color: 'var(--td)' }}>Planned end: </span>
                                    <span style={{ fontSize: 11.5, color: 'var(--tm)', fontFamily: "'JetBrains Mono', monospace" }}>
                                      {new Date(m.planned_end).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Notes / Comments thread */}
                            <div>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>
                                Notes &amp; Comments {noteLines.length > 0 && `(${noteLines.length})`}
                              </div>
                              {noteLines.length > 0 ? (
                                <div style={{
                                  background: 'var(--g-softer)', borderRadius: 6,
                                  border: '1px solid var(--border)',
                                  padding: '8px 12px', marginBottom: 8,
                                  maxHeight: 180, overflowY: 'auto',
                                }}>
                                  {noteLines.map((line, i) => {
                                    const match = line.match(/^\[([^\]]+)\]\s(.+)$/);
                                    return (
                                      <div key={i} style={{
                                        marginBottom: i < noteLines.length - 1 ? 8 : 0,
                                        paddingBottom: i < noteLines.length - 1 ? 8 : 0,
                                        borderBottom: i < noteLines.length - 1 ? '1px solid var(--border)' : 'none',
                                      }}>
                                        {match ? (
                                          <>
                                            <div style={{ fontSize: 10.5, color: 'var(--td)', marginBottom: 2 }}>{match[1]}</div>
                                            <div style={{ fontSize: 12.5, color: 'var(--tx)', lineHeight: 1.5 }}>{match[2]}</div>
                                          </>
                                        ) : (
                                          <div style={{ fontSize: 12.5, color: 'var(--tx)', lineHeight: 1.5 }}>{line}</div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div style={{ fontSize: 12, color: 'var(--td)', marginBottom: 8 }}>No notes yet.</div>
                              )}

                              {/* Add note form */}
                              {canWrite && (
                                addingNote === oid ? (
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                    <textarea
                                      value={noteText}
                                      onChange={e => setNoteText(e.target.value)}
                                      placeholder="Add a note or update…"
                                      rows={2}
                                      style={{ flex: 1, resize: 'vertical', fontSize: 12.5 }}
                                      autoFocus
                                    />
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <button className="primary"
                                        style={{ padding: '4px 12px', fontSize: 12 }}
                                        onClick={() => submitNote(oid)}
                                        disabled={!noteText.trim()}
                                      >
                                        Add
                                      </button>
                                      <button className="ghost"
                                        style={{ padding: '4px 12px', fontSize: 12 }}
                                        onClick={() => { setAddingNote(null); setNoteText(''); }}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    className="ghost small"
                                    onClick={() => { setAddingNote(oid); setNoteText(''); }}
                                  >
                                    + Add note
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {!visible.length && (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: 28, color: 'var(--td)', fontSize: 13 }}>
                    {filter ? 'No orders match the filter.' : 'No maintenance orders yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create order modal */}
      {showNew && (
        <NewOrderModal
          equipment={equipment}
          technicians={canAssign ? technicians : []}
          canAssign={canAssign}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}
    </div>
  );
}

/* ── New order modal ── */
function NewOrderModal({ equipment, technicians, canAssign, onClose, onSaved }) {
  const first   = equipment[0];
  const firstId = first ? (first.id ?? first.equipment_id) : '';
  const [form, setForm] = useState({
    equipment_id:  firstId,
    order_type:    'preventive',
    title:         '',
    description:   '',
    priority:      'normal',
    planned_start: '',
    planned_end:   '',
    assigned_to:   '',
    notes:         '',
  });
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required'); return; }
    setBusy(true); setError('');
    try {
      await MaintApi.create({
        ...form,
        equipment_id:  Number(form.equipment_id),
        assigned_to:   form.assigned_to ? Number(form.assigned_to) : null,
        planned_start: form.planned_start || null,
        planned_end:   form.planned_end   || null,
        notes:         form.notes.trim() || null,
      });
      onSaved();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to create order');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={submit}
        style={{ minWidth: 560, maxWidth: 720, width: '90vw' }}>
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>New Maintenance Order</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Equipment</span>
            <select value={form.equipment_id} onChange={e => set('equipment_id', e.target.value)}>
              {equipment.map(e => (
                <option key={e.id ?? e.equipment_id} value={e.id ?? e.equipment_id}>
                  {(e.tag ?? e.tag_code)} — {e.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Order Type</span>
            <select value={form.order_type} onChange={e => set('order_type', e.target.value)}>
              {ORDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Title *</span>
          <input value={form.title} onChange={e => set('title', e.target.value)} required
            placeholder="e.g. Replace bearing on pump 310A_VP_01S" />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Description</span>
          <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)}
            placeholder="Detailed description of the work required…" />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Priority</span>
            <select value={form.priority} onChange={e => set('priority', e.target.value)}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          {canAssign && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Assign To</span>
              <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}>
                <option value="">— Unassigned —</option>
                {technicians.map(t => (
                  <option key={t.id} value={t.id}>{t.username} ({t.role})</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Planned Start</span>
            <input type="datetime-local" value={form.planned_start} onChange={e => set('planned_start', e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Planned End</span>
            <input type="datetime-local" value={form.planned_end} onChange={e => set('planned_end', e.target.value)} />
          </label>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>
            Initial Note (optional)
          </span>
          <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="Any additional context or instructions…" />
        </label>

        {error && <div className="error" style={{ marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create Order'}</button>
        </div>
      </form>
    </div>
  );
}
