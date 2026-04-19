/**
 * Admin user-management page: list users, create a new one, toggle active
 * status, change role, or delete.
 */
import { useEffect, useState } from 'react';
import { Users as UsersApi } from '../services/api';

export default function Users() {
  const [items, setItems] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    UsersApi.list()
      .then((d) => setItems(d.items || d))
      .catch((e) => setError(e.response?.data?.message || 'Failed to load users'));
  };

  useEffect(() => { load(); }, []);

  const toggle = async (u) => {
    try { await UsersApi.active(u.id, !u.is_active); load(); }
    catch (e) { setError(e.response?.data?.message || 'Failed'); }
  };

  const setRole = async (u, role) => {
    try { await UsersApi.role(u.id, role); load(); }
    catch (e) { setError(e.response?.data?.message || 'Failed'); }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete user ${u.username}?`)) return;
    try { await UsersApi.remove(u.id); load(); }
    catch (e) { setError(e.response?.data?.message || 'Failed'); }
  };

  return (
    <div>
      <div className="page-head">
        <h2>Users & permissions</h2>
        <button className="primary" onClick={() => setShowNew(true)}>+ Add user</button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Username</th><th>Full name</th><th>Email</th>
              <th>Role</th><th>Active</th><th>Last login</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map(u => (
              <tr key={u.id}>
                <td>
                  <code>{u.username}</code>
                  {u.protected && (
                    <span
                      title="System account — protected from modification"
                      style={{
                        marginLeft: 6, fontSize: 10, padding: '1px 6px',
                        borderRadius: 6, background: 'var(--ocp-tint, #DFF0E4)',
                        color: 'var(--ocp-deep, #0A4F2A)', fontWeight: 700,
                        letterSpacing: '.4px', border: '1px solid var(--ocp-primary, #0A4F2A)',
                      }}>
                      🔒 SYSTEM
                    </span>
                  )}
                </td>
                <td>{u.full_name}</td>
                <td className="muted">{u.email || '—'}</td>
                <td>
                  <select
                    value={u.role}
                    disabled={u.protected}
                    title={u.protected ? 'System Administrator role is locked' : ''}
                    onChange={(e) => setRole(u, e.target.value)}
                  >
                    <option value="admin">admin</option>
                    <option value="supervisor">supervisor</option>
                    <option value="technician">technician</option>
                    <option value="operator">operator</option>
                    <option value="viewer">viewer</option>
                  </select>
                </td>
                <td>
                  <button
                    className="ghost small"
                    disabled={u.protected}
                    title={u.protected ? 'System Administrator cannot be disabled' : ''}
                    onClick={() => toggle(u)}
                  >
                    {u.is_active ? '● Enabled' : '○ Disabled'}
                  </button>
                </td>
                <td className="muted">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="ghost small"
                    disabled={u.protected}
                    title={u.protected ? 'System Administrator cannot be deleted' : ''}
                    onClick={() => remove(u)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewUserModal onClose={() => setShowNew(false)}
                      onSaved={() => { setShowNew(false); load(); }} />
      )}
    </div>
  );
}

function NewUserModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    username: '', password: '', full_name: '', email: '', role: 'technician',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await UsersApi.create(form); onSaved(); }
    catch (e) { setError(e.response?.data?.message || 'Failed to create user'); }
    finally   { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>New user</h3>
        <div className="grid-2">
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Username</span>
            <input value={form.username} onChange={(e) => set('username', e.target.value)} required />
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Password</span>
            <input type="password" value={form.password}
                   onChange={(e) => set('password', e.target.value)} required />
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Full name</span>
            <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Email</span>
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </label>
          <label style={{ gridColumn: 'span 2' }}>
            <span className="muted" style={{ fontSize: 12 }}>Role</span>
            <select value={form.role} onChange={(e) => set('role', e.target.value)}>
              <option value="admin">admin</option>
              <option value="supervisor">supervisor</option>
              <option value="technician">technician</option>
              <option value="operator">operator</option>
              <option value="viewer">viewer</option>
            </select>
          </label>
        </div>
        {error && <div className="error">{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Create'}</button>
        </div>
      </form>
    </div>
  );
}
