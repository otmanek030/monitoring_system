/**
 * Maintenance orders: list, create new (modal), update status inline.
 * Column "Linked to" shows the triggering alarm or sensor when available.
 */
import { useEffect, useState } from 'react';
import { Maintenance as MaintApi, Equipment as EqApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const statusColors = {
  open:        { bg: '#2a3a55', fg: '#9fb6d9' },
  in_progress: { bg: '#4a3a1a', fg: '#ffb04a' },
  done:        { bg: '#1c3c2b', fg: '#2cd08c' },
  cancelled:   { bg: '#2a2f3b', fg: '#7b8799' },
};

export default function Maintenance() {
  const [items, setItems] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [filter, setFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');
  const { can } = useAuth();

  const load = () => {
    MaintApi.list({ limit: 200 })
      .then((d) => setItems(d.items || d))
      .catch((e) => setError(e.response?.data?.message || 'Failed to load'));
  };

  useEffect(() => {
    load();
    EqApi.list().then(d => setEquipment(d.items || d)).catch(() => {});
  }, []);

  const changeStatus = async (id, status) => {
    try { await MaintApi.update(id, { status }); load(); }
    catch (e) { setError(e.response?.data?.message || 'Update failed'); }
  };

  const visible = items.filter(i =>
    !filter || i.status === filter || (i.title || '').toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div>
      <div className="page-head">
        <h2>Maintenance orders</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {can('maintenance', 'c') && (
            <button className="primary" onClick={() => setShowNew(true)}>+ New order</button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>#</th><th>Title</th><th>Equipment</th><th>Priority</th>
              <th>Status</th><th>Due</th><th>Created</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(m => (
              <tr key={m.id}>
                <td>#{m.id}</td>
                <td>{m.title}</td>
                <td><code>{m.equipment_tag || '--'}</code></td>
                <td>{m.priority}</td>
                <td>
                  <span className="badge" style={statusColors[m.status] || statusColors.open}>
                    {m.status}
                  </span>
                </td>
                <td className="muted">{m.due_at ? new Date(m.due_at).toLocaleDateString() : '—'}</td>
                <td className="muted">{new Date(m.created_at).toLocaleDateString()}</td>
                <td style={{ textAlign: 'right' }}>
                  {can('maintenance', 'u') && m.status !== 'done' && (
                    <select value={m.status}
                            onChange={(e) => changeStatus(m.id, e.target.value)}
                            style={{ width: 130 }}>
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="done">Done</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  )}
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr><td colSpan="8" className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No orders yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewOrderModal equipment={equipment}
                       onClose={() => setShowNew(false)}
                       onSaved={() => { setShowNew(false); load(); }} />
      )}
    </div>
  );
}

function NewOrderModal({ equipment, onClose, onSaved }) {
  const [form, setForm] = useState({
    equipment_id: equipment[0]?.id || '',
    title: '',
    description: '',
    priority: 'medium',
    due_at: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await MaintApi.create({
        ...form,
        equipment_id: Number(form.equipment_id),
        due_at: form.due_at || null,
      });
      onSaved();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to create order');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>New maintenance order</h3>
        <label>
          <span className="muted" style={{ fontSize: 12 }}>Equipment</span>
          <select value={form.equipment_id} onChange={(e) => set('equipment_id', e.target.value)}>
            {equipment.map(e => <option key={e.id} value={e.id}>{e.tag} — {e.name}</option>)}
          </select>
        </label>
        <label>
          <span className="muted" style={{ fontSize: 12 }}>Title</span>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} required />
        </label>
        <label>
          <span className="muted" style={{ fontSize: 12 }}>Description</span>
          <textarea rows="3" value={form.description}
                    onChange={(e) => set('description', e.target.value)} />
        </label>
        <div className="grid-2">
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Priority</span>
            <select value={form.priority} onChange={(e) => set('priority', e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Due date</span>
            <input type="date" value={form.due_at}
                   onChange={(e) => set('due_at', e.target.value)} />
          </label>
        </div>
        {error && <div className="error">{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
