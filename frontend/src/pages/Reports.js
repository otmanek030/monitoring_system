/**
 * Reports page.
 *
 * Features:
 *   1. ReportGenerator — plant-wide reports (xlsx/pdf) for users with reports:r
 *   2. Shift report PDF — includes notes, alarms, work orders
 *   3. Recent Shift Notes preview — visible in the page itself, included in exports
 */
import { useEffect, useState } from 'react';
import ReportGenerator from '../components/Reports/ReportGenerator';
import { Equipment as EqApi, Reports as ReportsApi, Notes as NotesApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const SEV_COLOR = { info: 'var(--cyan)', warning: 'var(--yellow)', critical: 'var(--red)' };
const CAT_ICON  = { observation: '👁', incident: '⚠', handover: '🔄', maintenance: '🔧', safety: '🦺' };

export default function Reports() {
  const [equipment, setEquipment] = useState([]);
  const [notes,     setNotes]     = useState([]);
  const { can, user } = useAuth();

  useEffect(() => {
    EqApi.list()
      .then(d => setEquipment(d.items || d.equipment || d || []))
      .catch(() => {});
  }, []);

  /* Load today's shift notes for preview */
  useEffect(() => {
    NotesApi.list({ limit: 20 })
      .then(d => setNotes(d.items || []))
      .catch(() => {});
  }, []);

  const canPlantReports = can('reports', 'r');
  const canShiftReport  = can('my_shift', 'r');

  return (
    <div>
      <div className="page-head">
        <h2>Reports &amp; Exports</h2>
        <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
          On-demand xlsx / pdf generation — streamed from the backend
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: canPlantReports ? '1fr 1fr' : '1fr', gap: 12 }}>
        {canPlantReports && <ReportGenerator equipment={equipment} />}
        {canShiftReport  && <ShiftReportCard username={user?.username} />}

        {/* Available types reference */}
        <div className="panel">
          <div className="panel-head">
            <span className="title">Available Report Types</span>
            <span className="menu">⋯</span>
          </div>
          <div className="panel-body" style={{ gap: 8 }}>
            {canPlantReports && (
              <>
                <ReportTypeRow icon="📊" label="Equipment (xlsx)" desc="Sensor readings + alarms + aggregated stats per sensor" />
                <ReportTypeRow icon="📄" label="Equipment (pdf)"  desc="Executive summary: health score, RUL, alarm count" />
                <ReportTypeRow icon="📋" label="Alarms log (xlsx)" desc="All alarms in date range with ack info and trigger values" />
                <ReportTypeRow icon="🏭" label="Plant summary (pdf)" desc="KPIs, top offenders, AI predictions, maintenance status" />
              </>
            )}
            {canShiftReport && (
              <ReportTypeRow icon="📝" label="My shift (pdf)"
                desc="Your shift notes, raised alarms, and assigned work orders — includes all notes visible below" />
            )}
          </div>
        </div>
      </div>

      {/* ── Shift Notes Preview ── */}
      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-head">
          <span className="title">Shift Notes</span>
          <span style={{ fontSize: 10.5, color: 'var(--tm)', marginLeft: 4 }}>
            {notes.length} recent note(s) · included in shift PDF exports
          </span>
          <span className="menu">⋯</span>
        </div>
        {notes.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--td)', fontSize: 12.5 }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>📋</div>
            No shift notes found — go to the Notes page to add them.
          </div>
        ) : (
          <div style={{ overflowY: 'auto', maxHeight: 400 }}>
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
                {notes.map(n => (
                  <tr key={n.id} style={{
                    borderLeft: `3px solid ${SEV_COLOR[n.severity] || 'transparent'}`,
                  }}>
                    <td>
                      <span style={{
                        fontSize: 10.5, fontWeight: 600,
                        color: SEV_COLOR[n.severity] || 'var(--tm)',
                        textTransform: 'uppercase',
                      }}>
                        {n.severity}
                      </span>
                    </td>
                    <td style={{ fontSize: 11.5 }}>
                      {CAT_ICON[n.category] || '📝'} {n.category}
                    </td>
                    <td style={{ fontWeight: 500, maxWidth: 220, fontSize: 12 }}>
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

/* ── Report type row ── */
function ReportTypeRow({ icon, label, desc }) {
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      padding: '8px 0', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tx)' }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--td)' }}>{desc}</div>
      </div>
    </div>
  );
}

/* ── Shift report PDF card ── */
function todayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}

function ShiftReportCard({ username }) {
  const [from, setFrom] = useState(() => todayStart().toISOString().slice(0, 16));
  const [to,   setTo]   = useState(() => new Date().toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  const run = async () => {
    setBusy(true); setErr('');
    try {
      const fromIso = new Date(from).toISOString();
      const toIso   = new Date(to).toISOString();
      await ReportsApi.download(
        ReportsApi.myShiftPdfUrl(fromIso, toIso),
        `shift_${username || 'me'}_${fromIso.slice(0, 10)}.pdf`
      );
    } catch (e) {
      setErr(e.response?.data?.message || 'Failed to generate PDF');
    } finally { setBusy(false); }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">My Shift Report</span>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: .5,
          color: 'var(--g)', border: '1px solid var(--g)', borderRadius: 4,
          padding: '1px 6px', textTransform: 'uppercase',
        }}>PDF</span>
        <span className="menu">⋯</span>
      </div>
      <div className="panel-body" style={{ gap: 12 }}>
        <p style={{ fontSize: 12.5, color: 'var(--tm)', margin: 0 }}>
          Generates a PDF containing <strong>your shift notes</strong>, raised alarms,
          and work orders assigned to you in the selected time range.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>From</span>
            <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>To</span>
            <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
          </label>
        </div>

        {err && <div className="error">{err}</div>}

        <button className="primary" onClick={run} disabled={busy} style={{ width: '100%' }}>
          {busy ? '⏳ Generating PDF…' : '📄 Generate Shift PDF'}
        </button>
      </div>
    </div>
  );
}
