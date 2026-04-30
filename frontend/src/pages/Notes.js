/**
 * Shift Notes & Logbook
 *
 * Operators, technicians, and supervisors can write shift notes.
 * Improved design: card feed with severity-coded borders, metadata badges,
 * and a clear CTA for the shift PDF export.
 *
 * Notes are included in both the Reports page and the "My Shift PDF" export.
 */
import { useEffect, useMemo, useState } from 'react';
import { Notes as NotesApi, Equipment, Reports } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import TableSearch from '../components/TableSearch';

const CATEGORIES = [
  { value: 'observation', label: 'Observation', icon: '👁' },
  { value: 'incident',    label: 'Incident',    icon: '⚠' },
  { value: 'handover',    label: 'Shift Handover', icon: '🔄' },
  { value: 'maintenance', label: 'Maintenance', icon: '🔧' },
  { value: 'safety',      label: 'Safety',      icon: '🦺' },
];

const SHIFTS = [
  { value: 'day',       label: 'Day (06-14)'      },
  { value: 'afternoon', label: 'Afternoon (14-22)' },
  { value: 'night',     label: 'Night (22-06)'    },
];

const SEVERITIES = [
  { value: 'info',     label: 'Info',     color: 'var(--cyan)' },
  { value: 'warning',  label: 'Warning',  color: 'var(--yellow)' },
  { value: 'critical', label: 'Critical', color: 'var(--red)' },
];

const SEV_STYLE = {
  info:     { border: 'var(--cyan)',   bg: 'rgba(42,163,176,.06)'  },
  warning:  { border: 'var(--yellow)', bg: 'rgba(212,177,60,.06)'  },
  critical: { border: 'var(--red)',    bg: 'rgba(214,69,69,.06)'   },
};

const CAT_ICON = Object.fromEntries(CATEGORIES.map(c => [c.value, c.icon]));

function todayAt(h = 0) {
  const d = new Date(); d.setHours(h, 0, 0, 0); return d;
}

export default function Notes() {
  const { user, can } = useAuth();
  const [items, setItems]     = useState([]);
  const [equip, setEquip]     = useState([]);
  const [filter, setFilter]   = useState({ shift: '', category: '', severity: '', mine: false });
  const [error, setError]     = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy]       = useState(false);
  const [search, setSearch]   = useState('');

  const canWrite     = can('notes', 'w');
  const canManageAny = can('users', 'r');
  const canShiftPdf  = can('my_shift', 'r');

  const load = () => {
    const params = {};
    if (filter.shift)    params.shift    = filter.shift;
    if (filter.category) params.category = filter.category;
    if (filter.mine)     params.mine     = '1';
    NotesApi.list(params)
      .then(d => setItems(d.items || []))
      .catch(e => setError(e.response?.data?.message || 'Failed to load notes'));
  };

  useEffect(() => { load(); }, [filter.shift, filter.category, filter.mine]); // eslint-disable-line

  useEffect(() => {
    Equipment.list()
      .then(d => setEquip(d.items || d.equipment || d || []))
      .catch(() => setEquip([]));
  }, []);

  const ownsOrMgr = n => n.user_id === user?.id || canManageAny;

  const remove = async (n) => {
    if (!window.confirm(`Delete note "${n.title}"?`)) return;
    try { await NotesApi.remove(n.id); load(); }
    catch (e) { setError(e.response?.data?.message || 'Failed to delete note'); }
  };

  const exportShiftPdf = async () => {
    setBusy(true); setError('');
    try {
      const from = todayAt(0).toISOString();
      const to   = new Date().toISOString();
      await Reports.download(
        Reports.myShiftPdfUrl(from, to),
        `shift_${user?.username || 'me'}_${from.slice(0, 10)}.pdf`
      );
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to generate shift PDF');
    } finally { setBusy(false); }
  };

  /* Client-side search */
  const visible = items.filter(n => {
    if (filter.severity && n.severity !== filter.severity) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (n.title || '').toLowerCase().includes(q) ||
           (n.body  || '').toLowerCase().includes(q) ||
           (n.author || '').toLowerCase().includes(q);
  });

  /* Stats */
  const critCount = items.filter(n => n.severity === 'critical').length;
  const warnCount = items.filter(n => n.severity === 'warning').length;

  return (
    <div>
      {/* ── Page head ── */}
      <div className="page-head">
        <div>
          <h2>Shift Notes &amp; Logbook</h2>
          <div style={{ fontSize: 11.5, color: 'var(--tm)', marginTop: 2 }}>
            {items.length} note(s)
            {critCount > 0 && <span style={{ color: 'var(--red)', marginLeft: 6 }}>· {critCount} critical</span>}
            {warnCount > 0 && <span style={{ color: 'var(--yellow)', marginLeft: 6 }}>· {warnCount} warnings</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {canShiftPdf && (
            <button className="ghost" onClick={exportShiftPdf} disabled={busy}>
              📄 {busy ? 'Preparing…' : 'My Shift PDF'}
            </button>
          )}
          {canWrite && (
            <button className="primary" onClick={() => setShowNew(true)}>+ New Note</button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {/* ── Filters ── */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '10px 14px', alignItems: 'center' }}>
          <TableSearch
            value={search}
            onChange={setSearch}
            total={items.length}
            shown={visible.length}
            placeholder="Search notes by title, body, author…"
            width={260}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>Shift</span>
            <select value={filter.shift} onChange={e => setFilter(f => ({ ...f, shift: e.target.value }))}>
              <option value="">All</option>
              {SHIFTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>Category</span>
            <select value={filter.category} onChange={e => setFilter(f => ({ ...f, category: e.target.value }))}>
              <option value="">All</option>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>Severity</span>
            <select value={filter.severity} onChange={e => setFilter(f => ({ ...f, severity: e.target.value }))}>
              <option value="">All</option>
              {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={filter.mine}
              onChange={e => setFilter(f => ({ ...f, mine: e.target.checked }))} />
            <span style={{ fontSize: 11.5 }}>My notes only</span>
          </label>
        </div>
      </div>

      {/* ── Notes feed ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visible.length === 0 && (
          <div className="panel" style={{ textAlign: 'center', padding: 32, color: 'var(--td)' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tm)', marginBottom: 4 }}>
              No notes found
            </div>
            <div style={{ fontSize: 12 }}>
              {canWrite ? 'Click "New Note" to create the first one.' : 'No notes match the current filters.'}
            </div>
          </div>
        )}
        {visible.map(n => (
          <NoteCard key={n.id} note={n}
            canEdit={ownsOrMgr(n)}
            onEdit={() => setEditing(n)}
            onDelete={() => remove(n)} />
        ))}
      </div>

      {/* ── Modals ── */}
      {showNew && (
        <NoteModal title="New Note" equipment={equip}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }} />
      )}
      {editing && (
        <NoteModal title="Edit Note" equipment={equip} initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

/* ── Note card ── */
function NoteCard({ note, canEdit, onEdit, onDelete }) {
  const sev    = note.severity || 'info';
  const sStyle = SEV_STYLE[sev] || SEV_STYLE.info;
  const catIcon = CAT_ICON[note.category] || '📝';
  const when   = note.created_at
    ? new Date(note.created_at).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '';
  const [expanded, setExpanded] = useState(false);
  const bodyPreview = (note.body || '').length > 200 && !expanded
    ? note.body.slice(0, 198) + '…'
    : note.body;

  return (
    <div className="panel" style={{
      borderLeft: `3px solid ${sStyle.border}`,
      background: sStyle.bg,
    }}>
      {/* Card header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', gap: 12,
        padding: '12px 14px 8px',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx)' }}>{note.title}</span>
            <span style={{
              fontSize: 10.5, fontWeight: 600, letterSpacing: .5,
              color: sStyle.border, background: 'transparent',
              border: `1px solid ${sStyle.border}`, borderRadius: 4, padding: '1px 6px',
              textTransform: 'uppercase',
            }}>
              {sev}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--tm)', background: 'var(--g-softer)', borderRadius: 4, padding: '2px 7px', border: '1px solid var(--border)' }}>
              {catIcon} {CATEGORIES.find(c => c.value === note.category)?.label || note.category}
            </span>
            {note.shift && (
              <span style={{ fontSize: 11, color: 'var(--tm)', background: 'var(--g-softer)', borderRadius: 4, padding: '2px 7px', border: '1px solid var(--border)' }}>
                🕐 {SHIFTS.find(s => s.value === note.shift)?.label || note.shift}
              </span>
            )}
            {note.equipment_tag && (
              <code style={{ fontSize: 11, color: 'var(--g)', background: 'rgba(0,122,61,.08)', borderRadius: 4, padding: '2px 7px', border: '1px solid rgba(0,122,61,.15)' }}>
                {note.equipment_tag}
              </code>
            )}
          </div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button className="ghost small" onClick={onEdit}>Edit</button>
            <button className="ghost small" style={{ color: 'var(--red)' }} onClick={onDelete}>Delete</button>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '0 14px 10px', color: 'var(--tx)', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
        {bodyPreview}
        {(note.body || '').length > 200 && (
          <button
            style={{ marginLeft: 6, fontSize: 11, color: 'var(--g)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '6px 14px 10px',
        fontSize: 11, color: 'var(--td)',
        borderTop: '1px solid var(--border)',
        display: 'flex', gap: 12, alignItems: 'center',
      }}>
        <span>by <strong style={{ color: 'var(--tm)' }}>{note.author || note.username || '—'}</strong></span>
        <span>·</span>
        <span>{when}</span>
      </div>
    </div>
  );
}

/* ── Note create/edit modal ── */
function NoteModal({ title, equipment, initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => initial ? {
    title: initial.title || '',
    body: initial.body || '',
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
  const [err, setErr]   = useState('');
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
    if (!form.title.trim()) { setErr('Title is required'); return; }
    if (!form.body.trim())  { setErr('Details are required'); return; }
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
        style={{ minWidth: 560, maxWidth: 700, width: '90vw' }}>
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>{title}</h3>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Title *</span>
          <input value={form.title} onChange={e => set('title', e.target.value)}
            required placeholder="e.g. High vibration on pump 310A_VP_01S" />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Shift</span>
            <select value={form.shift} onChange={e => set('shift', e.target.value)}>
              {SHIFTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Category</span>
            <select value={form.category} onChange={e => set('category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Severity</span>
            <select value={form.severity} onChange={e => set('severity', e.target.value)}>
              {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Equipment (optional)</span>
          <select value={form.equipment_id} onChange={e => set('equipment_id', e.target.value)}>
            <option value="">— none —</option>
            {equipmentList.map(e => (
              <option key={e.id} value={e.id}>{e.tag} — {e.name}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Details *</span>
          <textarea rows={6} value={form.body}
            onChange={e => set('body', e.target.value)}
            required
            placeholder="Describe what you observed, any actions taken, and any follow-up required..."
            style={{ resize: 'vertical' }}
          />
        </label>

        {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save Note'}</button>
        </div>
      </form>
    </div>
  );
}
