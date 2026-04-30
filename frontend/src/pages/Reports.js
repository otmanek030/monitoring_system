/**
 * Reports — professional, clean dashboard.
 *
 * Layout:
 *   ┌────────── PAGE HEADER (title + summary) ──────────┐
 *   │                                                    │
 *   │ ┌──────────────┐  ┌──────────────┐                 │
 *   │ │ Generate     │  │ Available    │                 │
 *   │ │ report       │  │ types        │                 │
 *   │ └──────────────┘  └──────────────┘                 │
 *   │                                                    │
 *   │ ┌──────────────┐                                   │
 *   │ │ My shift PDF │                                   │
 *   │ └──────────────┘                                   │
 *   │                                                    │
 *   │ ┌────────────────────────────────────────────────┐ │
 *   │ │ Recent shift notes (with search)              │ │
 *   │ └────────────────────────────────────────────────┘ │
 *   └────────────────────────────────────────────────────┘
 */
import { useEffect, useState } from 'react';
import ReportGenerator from '../components/Reports/ReportGenerator';
import { Equipment as EqApi, Reports as ReportsApi, Notes as NotesApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import TableSearch, { useTableSearch, NoResultsRow } from '../components/TableSearch';

const SEV_COLOR = { info: 'var(--cyan)', warning: 'var(--yellow)', critical: 'var(--red)' };
const CAT_ICON  = { observation: '👁', incident: '⚠', handover: '🔄', maintenance: '🔧', safety: '🦺' };

export default function Reports() {
  const [equipment, setEquipment] = useState([]);
  const [notes,     setNotes]     = useState([]);
  const [search,    setSearch]    = useState('');
  const { can, user } = useAuth();

  useEffect(() => {
    EqApi.list().then(d => setEquipment(d.items || d.equipment || d || [])).catch(() => {});
    NotesApi.list({ limit: 50 }).then(d => setNotes(d.items || [])).catch(() => {});
  }, []);

  const canPlantReports = can('reports', 'r');
  const canShiftReport  = can('my_shift', 'r');

  const visibleNotes = useTableSearch(notes, search, [
    'title', 'body', 'author', 'username', 'category', 'shift', 'severity', 'equipment_tag',
  ]);

  /* Tile metadata for the right-hand catalog */
  const reportTypes = [
    canPlantReports && { icon: '📊', tag: 'XLSX', label: 'Equipment readings',
      desc: 'All sensor data, alarms, and aggregated stats per sensor for the chosen asset.' },
    canPlantReports && { icon: '📄', tag: 'PDF', label: 'Equipment summary',
      desc: 'Executive summary: health score, RUL, alarm count, top events.' },
    canPlantReports && { icon: '📋', tag: 'XLSX', label: 'Alarms log',
      desc: 'Every alarm in the date range with ack info and trigger values.' },
    canPlantReports && { icon: '🏭', tag: 'PDF', label: 'Plant summary',
      desc: 'KPIs · top offenders · AI predictions · maintenance status.' },
    canShiftReport && { icon: '📝', tag: 'PDF', label: 'My shift',
      desc: 'Your shift notes, raised alarms, and assigned work orders for the period.' },
  ].filter(Boolean);

  return (
    <div>
      {/* ── Page header ── */}
      <div className="page-head">
        <div>
          <h2 style={{ margin: 0 }}>Reports & Exports</h2>
          <div style={{ fontSize: 12, color: 'var(--tm)', marginTop: 4 }}>
            Build and download Excel / PDF reports — streamed straight from the backend.
            Everything is JWT-authenticated and rendered server-side from live Postgres data.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--tm)', flexWrap: 'wrap' }}>
          <KpiPill label="Equipment"   value={equipment.length}                    color="var(--g)" />
          <KpiPill label="Recent notes" value={notes.length}                        color="var(--cyan)" />
          <KpiPill label="Floor date"  value="15/04/2026"                          color="var(--tm)" mono />
        </div>
      </div>

      {/* ── Top row: Generator + Catalog (+ Shift card if permitted) ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: canShiftReport ? '1.4fr 1fr' : '1.4fr 1fr',
        gap: 14, marginBottom: 14,
      }}>
        {canPlantReports
          ? <ReportGenerator equipment={equipment} />
          : <RestrictedNotice />}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ReportTypesCatalog types={reportTypes} />
          {canShiftReport && <ShiftReportCard username={user?.username} />}
        </div>
      </div>

      {/* ── Recent shift notes preview, with search ── */}
      <div className="panel">
        <div className="panel-head" style={{ gap: 12 }}>
          <span className="title">Recent Shift Notes</span>
          <span style={{ fontSize: 10.5, color: 'var(--tm)' }}>
            Included verbatim in the PDF exports above.
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <TableSearch
              value={search}
              onChange={setSearch}
              total={notes.length}
              shown={visibleNotes.length}
              placeholder="Search title, body, author…"
            />
          </span>
        </div>

        {notes.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No shift notes yet"
            hint="Operators / technicians can add shift notes from the Notes page."
          />
        ) : (
          <div style={{ overflowY: 'auto', maxHeight: 460 }}>
            <table className="tbl">
              <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}>
                <tr>
                  <th>Severity</th>
                  <th>Category</th>
                  <th>Title</th>
                  <th>Equipment</th>
                  <th>Shift</th>
                  <th>Author</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {!visibleNotes.length && (
                  <NoResultsRow colSpan={7} query={search} />
                )}
                {visibleNotes.map(n => (
                  <tr key={n.id} style={{
                    borderLeft: `3px solid ${SEV_COLOR[n.severity] || 'transparent'}`,
                  }}>
                    <td>
                      <span style={{
                        fontSize: 10.5, fontWeight: 700,
                        color: SEV_COLOR[n.severity] || 'var(--tm)',
                        textTransform: 'uppercase', letterSpacing: .4,
                      }}>
                        {n.severity}
                      </span>
                    </td>
                    <td style={{ fontSize: 11.5 }}>
                      {CAT_ICON[n.category] || '📝'} {n.category}
                    </td>
                    <td style={{ fontWeight: 500, maxWidth: 280, fontSize: 12 }}>
                      {n.title}
                    </td>
                    <td>
                      {n.equipment_tag
                        ? <code style={{ fontSize: 11 }}>{n.equipment_tag}</code>
                        : <span style={{ color: 'var(--td)' }}>—</span>}
                    </td>
                    <td style={{ fontSize: 11.5, color: 'var(--tm)' }}>{n.shift}</td>
                    <td style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                      {n.author || n.username || '—'}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--td)', fontFamily: "'JetBrains Mono', monospace" }}>
                      {n.created_at
                        ? new Date(n.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Header KPI pill ── */
function KpiPill({ label, value, color, mono }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid var(--border)',
      borderRadius: 6,
      padding: '6px 10px',
      display: 'flex', flexDirection: 'column',
      minWidth: 90,
    }}>
      <span style={{ fontSize: 9.5, color: 'var(--td)', letterSpacing: .5, textTransform: 'uppercase' }}>{label}</span>
      <span style={{
        fontSize: 14, fontWeight: 700, color,
        fontFamily: mono ? "'JetBrains Mono', monospace" : 'inherit',
      }}>
        {value}
      </span>
    </div>
  );
}

/* ── Catalog: list of available report types ── */
function ReportTypesCatalog({ types }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">Available Report Types</span>
        <span className="menu">⋯</span>
      </div>
      <div className="panel-body" style={{ gap: 10, padding: '12px 14px' }}>
        {types.map((t, i) => (
          <div key={i} style={{
            display: 'flex', gap: 11, alignItems: 'flex-start',
            padding: '8px 10px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--g-softer)',
          }}>
            <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{t.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <strong style={{ fontSize: 12.5, color: 'var(--tx)' }}>{t.label}</strong>
                <span style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: .5,
                  color: 'var(--g)', border: '1px solid var(--g)', borderRadius: 4,
                  padding: '0px 6px', textTransform: 'uppercase',
                }}>
                  {t.tag}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--td)', lineHeight: 1.4 }}>
                {t.desc}
              </div>
            </div>
          </div>
        ))}
        {!types.length && (
          <div style={{ color: 'var(--td)', fontSize: 12, padding: 8 }}>
            No report types available for your role.
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Permission-restricted notice ── */
function RestrictedNotice() {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">Generate Report</span>
        <span className="menu">⋯</span>
      </div>
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--tm)' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Report generation is restricted.</div>
        <div style={{ fontSize: 11.5, color: 'var(--td)', marginTop: 4 }}>
          Ask an administrator to grant you the <code>reports:r</code> permission.
        </div>
      </div>
    </div>
  );
}

/* ── Empty-state placeholder ── */
function EmptyState({ icon, title, hint }) {
  return (
    <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--tm)' }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--td)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/* ── My shift PDF card — styled like ReportGenerator's success state ── */
function todayStart() { const d = new Date(); d.setHours(0,0,0,0); return d; }

function ShiftReportCard({ username }) {
  const [from, setFrom] = useState(() => todayStart().toISOString().slice(0, 16));
  const [to,   setTo]   = useState(() => new Date().toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const [done, setDone] = useState(null);

  const run = async () => {
    setBusy(true); setErr(''); setDone(null);
    try {
      const fromIso = new Date(from).toISOString();
      const toIso   = new Date(to).toISOString();
      const filename = `shift_${username || 'me'}_${fromIso.slice(0, 10)}.pdf`;
      await ReportsApi.download(ReportsApi.myShiftPdfUrl(fromIso, toIso), filename);
      setDone(filename);
    } catch (e) {
      setErr(e.response?.data?.message || 'Failed to generate PDF');
    } finally { setBusy(false); }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">My Shift Report</span>
        <span style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: .5,
          color: 'var(--g)', border: '1px solid var(--g)', borderRadius: 4,
          padding: '0px 6px', textTransform: 'uppercase',
        }}>PDF</span>
        <span className="menu">⋯</span>
      </div>
      <div className="panel-body" style={{ gap: 12, padding: '12px 14px' }}>
        <p style={{ fontSize: 12, color: 'var(--tm)', margin: 0, lineHeight: 1.5 }}>
          Includes <strong>your shift notes</strong>, raised alarms, and work orders
          assigned to you in the selected window.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--td)' }}>From</span>
            <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)}
              min="2026-04-15T00:00" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--td)' }}>To</span>
            <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} min={from} />
          </label>
        </div>

        {err && <div style={{
          border: '1px solid rgba(214,69,69,.3)', background: 'rgba(214,69,69,.06)',
          color: 'var(--red)', borderRadius: 6, padding: '7px 11px', fontSize: 12,
        }}>⚠ {err}</div>}
        {done && !busy && (
          <div style={{
            border: '1px solid rgba(0,122,61,.3)', background: 'rgba(0,122,61,.06)',
            color: 'var(--g)', borderRadius: 6, padding: '7px 11px', fontSize: 12,
          }}>
            ✓ Saved <code style={{ background: 'var(--g-softer)', padding: '1px 6px', borderRadius: 3 }}>{done}</code>
          </div>
        )}

        <button className="primary" onClick={run} disabled={busy}
          style={{ width: '100%', padding: '10px 12px', fontSize: 13, fontWeight: 700 }}>
          {busy ? '⏳ Generating PDF…' : '📄 Generate Shift PDF'}
        </button>
      </div>
    </div>
  );
}
