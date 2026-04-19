/**
 * Maintenance orders page.
 *
 * Role-aware:
 *   - list/view        : anyone with maintenance:r
 *   - create / update  : maintenance:w   (technician+)
 *   - assign to tech   : assign_maintenance:w  (supervisor+)
 *   - delete           : maintenance:w (backend enforces)
 *
 * Column statuses match DB schema: open | scheduled | in_progress
 *                                  | completed | cancelled
 */
import { useEffect, useState } from 'react';
import {
  Maintenance as MaintApi,
  Equipment   as EqApi,
  Users       as UsersApi,
} from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const STATUSES = [
  { value: 'open',        label: 'Open',        className: 'info'    },
  { value: 'scheduled',   label: 'Scheduled',   className: 'info'    },
  { value: 'in_progress', label: 'In progress', className: 'warn'    },
  { value: 'completed',   label: 'Completed',   className: 'ok'      },
  { value: 'cancelled',   label: 'Cancelled',   className: 'idle'    },
];

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const ORDER_TYPES = [
  'preventive', 'corrective', 'predictive', 'inspection', 'calibration',
];

function statusClass(s) {
  return STATUSES.find(x => x.value === s)?.className || 'info';
}

export default function Maintenance() {
  const [items,       setItems]       = useState([]);
  const [equipment,   setEquipment]   = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [filter,      setFilter]      = useState('');
  const [showNew,     setShowNew]     = useState(false);
  const [error,       setError]       = useState('');
  const { can, user } = useAuth();

  const canWrite  = can('maintenance', 'w');
  const canAssign = can('assign_maintenance', 'w');
  const canListUsers = user?.role === 'admin' || user?.role === 'supervisor';

  const load = () => {
    MaintApi.list({ limit: 200 })
      .then((d) => setItems(d.items || d || []))
      .catch((e) => setError(e.response?.data?.message || 'Failed to load'));
  };

  useEffect(() => {
    load();
    EqApi.list().then(d => setEquipment(d.items || d.equipment || d || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!canListUsers) return;
    UsersApi.list()
      .then(d => {
        const all = d.items || d.users || d || [];
        setTechnicians(
          all.filter(u => u.is_active &&
            ['technician','supervisor','admin'].includes(u.role))
        );
      }).catch(() => {});
  }, [canListUsers]);

  const changeStatus = async (id, status) => {
    try { await MaintApi.update(id, { status }); load(); }
    catch (e) { setError(e.response?.data?.message || 'Update failed'); }
  };

  const assignTo = async (id, userIdOrEmpty) => {
    try {
      await MaintApi.assign(id, userIdOrEmpty || null);
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Assign failed');
    }
  };

  const visible = items.filter(i =>
    !filter || i.status === filter
    || (i.title || '').toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div>
      <div className="page-head">
        <h2>Maintenance orders</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map(s =>
              <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {canWrite && (
            <button className="primary" onClick={() => setShowNew(true)}>
              + New order
            </button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="panel">
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>#</th><th>Title</th><th>Equipment</th>
                <th>Priority</th><th>Status</th>
                <th>Assigned</th><th>Created</th><th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(m => (
                <tr key={m.order_id || m.id}>
                  <td className="muted">#{m.order_id || m.id}</td>
                  <td>
                    <strong>{m.title}</strong>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {m.order_type}
                    </div>
                  </td>
                  <td><code>{m.equipment_tag || '--'}</code></td>
                  <td>{m.priority}</td>
                  <td>
                    <span className={`badge ${statusClass(m.status)}`}>
                      {m.status}
                    </span>
                  </td>
                  <td>
                    {canAssign ? (
                      <select
                        value={m.assigned_to || ''}
                        onChange={(e) => assignTo(m.order_id || m.id, e.target.value)}
                        style={{ minWidth: 150 }}>
                        <option value="">— Unassigned —</option>
                        {technicians.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.username} ({t.role})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="muted">
                        {m.assigned_to_username || '—'}
                      </span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {new Date(m.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {canWrite && m.status !== 'completed' && (
                      <select value={m.status}
                              onChange={(e) => changeStatus(m.order_id || m.id, e.target.value)}
                              style={{ width: 140 }}>
                        {STATUSES.map(s =>
                          <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr><td colSpan="8" className="muted"
                        style={{ textAlign: 'center', padding: 24 }}>
                  No orders yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <NewOrderModal
          equipment={equipment}
          technicians={canAssign ? technicians : []}
          canAssign={canAssign}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function NewOrderModal({ equipment, technicians, canAssign, onClose, onSaved }) {
  const first = equipment[0];
  const firstId = first ? (first.id ?? first.equipment_id) : '';
  const [form, setForm] = useState({
    equipment_id: firstId,
    order_type:   'preventive',
    title:        '',
    description:  '',
    priority:     'normal',
    planned_start:'',
    planned_end:  '',
    assigned_to:  '',
  });
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await MaintApi.create({
        ...form,
        equipment_id:  Number(form.equipment_id),
        assigned_to:   form.assigned_to ? Number(form.assigned_to) : null,
        planned_start: form.planned_start || null,
        planned_end:   form.planned_end   || null,
      });
      onSaved();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to create order');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}
            style={{ minWidth: 540 }}>
        <h3>New maintenance order</h3>

        <div className="grid-2" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Equipment</span>
            <select value={form.equipment_id}
                    onChange={(e) => set('equipment_id', e.target.value)}>
              {equipment.map(e => (
                <option key={e.id ?? e.equipment_id}
                        value={e.id ?? e.equipment_id}>
                  {(e.tag ?? e.tag_code)} — {e.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Order type</span>
            <select value={form.order_type}
                    onChange={(e) => set('order_type', e.target.value)}>
              {ORDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>

        <label>
          <span className="muted" style={{ fontSize: 12 }}>Title</span>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} required />
        </label>
        <label>
          <span className="muted" style={{ fontSize: 12 }}>Description</span>
          <textarea rows="3" value={form.description}
                    onChange={(e) => set('description', e.target.value)} />
        </label>

        <div className="grid-2" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Priority</span>
            <select value={form.priority}
                    onChange={(e) => set('priority', e.target.value)}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          {canAssign && (
            <label>
              <span className="muted" style={{ fontSize: 12 }}>Assign to</span>
              <select value={form.assigned_to}
                      onChange={(e) => set('assigned_to', e.target.value)}>
                <option value="">— Unassigned —</option>
                {technicians.map(t =>
                  <option key={t.id} value={t.id}>{t.username} ({t.role})</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="grid-2" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Planned start</span>
            <input type="datetime-local" value={form.planned_start}
                   onChange={(e) => set('planned_start', e.target.value)} />
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Planned end</span>
            <input type="datetime-local" value={form.planned_end}
                   onChange={(e) => set('planned_end', e.target.value)} />
          </label>
        </div>

        {error && <div className="error">{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Create order'}
          </button>
        </div>
      </form>
    </div>
  );
}
