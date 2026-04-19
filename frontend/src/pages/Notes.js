/**
 * Operator shift notes + "My Shift Report" PDF export.
 *
 * Access matrix:
 *   - read   (notes:r) : admin, supervisor, technician, operator
 *   - write  (notes:w) : admin, supervisor, technician, operator
 *   - delete (own)     : any writer for their own notes
 *   - delete (any)     : admin, supervisor (users:r)
 *   - PDF export       : anyone with my_shift:r  (operator+)
 */
import { useEffect, useMemo, useState } from 'react';
import { Notes as NotesApi, Equipment, Reports } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const CATEGORIES = [
  { value: 'observation', label: 'Observation' },
  { value: 'incident',    label: 'Incident'    },
  { value: 'handover',    label: 'Shift handover' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'safety',      label: 'Safety'      },
];
const SHIFTS = [
  { value: 'day',       label: 'Day (06-14)'   },
  { value: 'afternoon', label: 'Afternoon (14-22)' },
  { value: 'night',     label: 'Night (22-06)' },
];
const SEVERITIES = [
  { value: 'info',     label: 'Info' },
  { value: 'warning',  label: 'Warning' },
  { value: 'critical', label: 'Critical' },
];

function todayAt(h = 0) {
  const d = new Date(); d.setHours(h, 0, 0, 0); return d;
}

export default function Notes() {
  const { user, can } = useAuth();
  const [items, setItems]   = useState([]);
  const [equip, setEquip]   = useState([]);
  const [filter, setFilter] = useState({ shift: '', category: '', mine: false });
  const [error, setError]   = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const canWrite    = can('notes', 'w');
  const canManageAny = can('users', 'r');   // supervisor / admin
  const canShiftPdf = can('my_shift', 'r');

  const load = () => {
    const params = {};
    if (filter.shift)    params.shift    = filter.shift;
    if (filter.category) params.category = filter.category;
    if (filter.mine)     params.mine     = '1';
    NotesApi.list(params)
      .then(d => setItems(d.items || []))
      .catch(e => setError(e.response?.data?.message || 'Failed to load notes'));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter.shift, filter.category, filter.mine]);

  useEffect(() => {
    Equipment.list().then(d => setEquip(d.equipment || d || []))
      .catch(() => setEquip([]));
  }, []);

  const ownsOrMgr = (n) => n.user_id === user?.id || canManageAny;

  const remove = async (n) => {
    if (!window.confirm(`Delete note "${n.title}"?`)) return;
    try { await NotesApi.remove(n.id); load(); }
    catch (e) { setError(e.response?.data?.message || 'Failed'); }
  };

  const exportShiftPdf = async () => {
    setBusy(true); setError('');
    try {
      const from = todayAt(0).toISOString();
      const to   = new Date().toISOString();
      await Reports.download(
        Reports.myShiftPdfUrl(from, to),
        `shift_${user?.username || 'me'}_${from.slice(0,10)}.pdf`
      );
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to generate shift PDF');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="page-head">
        <h2>Shift notes &amp; logbook</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {canShiftPdf && (
            <button className="ghost" onClick={exportShiftPdf} disabled={busy}>
              📄 {busy ? 'Preparing…' : 'My shift PDF'}
            </button>
          )}
          {canWrite && (
            <button className="primary" onClick={() => setShowNew(true)}>+ New note</button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {/* Filters */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <label>
            <span className="muted" style={{ fontSize: 12, marginRight: 6 }}>Shift</span>
            <select value={filter.shift} onChange={e => setFilter(f => ({ ...f, shift: e.target.value }))}>
              <option value="">All</option>
              {SHIFTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12, marginRight: 6 }}>Category</span>
            <select value={filter.category}
                    onChange={e => setFilter(f => ({ ...f, category: e.target.value }))}>
              <option value="">All</option>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={filter.mine}
                   onChange={e => setFilter(f => ({ ...f, mine: e.target.checked }))} />
            <span>My notes only</span>
          </label>
          <div className="right muted" style={{ fontSize: 12 }}>{items.length} note(s)</div>
        </div>
      </div>

      {/* Notes feed */}
      <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 10 }}>
        {items.length === 0 && (
          <div className="card muted" style={{ textAlign: 'center', padding: 24 }}>
            No notes yet. {canWrite && 'Click "New note" to add one.'}
          </div>
        )}
        {items.map(n => (
          <NoteCard key={n.id} note={n}
            canEdit={ownsOrMgr(n)}
            onEdit={() => setEditing(n)}
            onDelete={() => remove(n)} />
        ))}
      </div>

      {showNew && (
        <NoteModal title="New note" equipment={equip}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }} />
      )}
      {editing && (
        <NoteModal title="Edit note" equipment={equip} initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function NoteCard({ note, canEdit, onEdit, onDelete }) {
  const sev = note.severity || 'info';
  const when = note.created_at ? new Date(note.created_at).toLocaleString() : '';
  return (
    <div className="panel">
      <div className="card-head">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 15 }}>{note.title}</strong>
          <span className={`pill sev-${sev}`}>{sev}</span>
          <span className="pill">{note.category}</span>
          <span className="pill">shift {note.shift}</span>
          {note.equipment_tag && <code>{note.equipment_tag}</code>}
        </div>
        {canEdit && (
          <div>
            <button className="ghost small" onClick={onEdit}>Edit</button>
            <button className="ghost small" onClick={onDelete}>Delete</button>
          </div>
        )}
      </div>
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{note.body}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        by <strong>{note.author || '—'}</strong> · {when}
      </div>
    </div>
  );
}

function NoteModal({ title, equipment, initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => initial ? {
    title: initial.title || '', body: initial.body || '',
    shift: initial.shift || 'day',
    category: initial.category || 'observation',
    severity: initial.severity || 'info',
    equipment_id: initial.equipment_id || '',
  } : {
    title: '', body: '',
    shift: 'day', category: 'observation', severity: 'info',
    equipment_id: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const equipmentList = useMemo(() => {
    return (equipment || []).map(e => ({
      id: e.id ?? e.equipment_id,
      tag: e.tag ?? e.tag_code,
      name: e.name,
    })).filter(e => e.id);
  }, [equipment]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const payload = { ...form, equipment_id: form.equipment_id || null };
      if (initial) await NotesApi.update(initial.id, payload);
      else         await NotesApi.create(payload);
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.message || 'Failed to save note');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={submit}
            style={{ minWidth: 520 }}>
        <h3>{title}</h3>

        <label>
          <span className="muted" style={{ fontSize: 12 }}>Title</span>
          <input value={form.title} onChange={e => set('title', e.target.value)}
                 required placeholder="e.g. Motor vibration above normal on WF-001" />
        </label>

        <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Shift</span>
            <select value={form.shift} onChange={e => set('shift', e.target.value)}>
              {SHIFTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Category</span>
            <select value={form.category} onChange={e => set('category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Severity</span>
            <select value={form.severity} onChange={e => set('severity', e.target.value)}>
              {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>

        <label>
          <span className="muted" style={{ fontSize: 12 }}>Equipment (optional)</span>
          <select value={form.equipment_id}
                  onChange={e => set('equipment_id', e.target.value)}>
            <option value="">— none —</option>
            {equipmentList.map(e => (
              <option key={e.id} value={e.id}>{e.tag} — {e.name}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="muted" style={{ fontSize: 12 }}>Details</span>
          <textarea rows={5} value={form.body}
                    onChange={e => set('body', e.target.value)}
                    required placeholder="What did you observe? Any corrective action?" />
        </label>

        {err && <div className="error">{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
