/**
 * Reports page.
 *
 * Two panels:
 *   1. ReportGenerator — for users with reports:r (plant-wide / equipment).
 *   2. "My shift PDF" — for anyone with my_shift:r (operator+).
 */
import { useEffect, useState } from 'react';
import ReportGenerator from '../components/Reports/ReportGenerator';
import { Equipment as EqApi, Reports as ReportsApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export default function Reports() {
  const [equipment, setEquipment] = useState([]);
  const { can, user } = useAuth();

  useEffect(() => {
    EqApi.list().then(d => setEquipment(d.items || d.equipment || d || []))
      .catch(() => {});
  }, []);

  const canPlantReports = can('reports', 'r');
  const canShiftReport  = can('my_shift', 'r');

  return (
    <div>
      <div className="page-head"><h2>Reports &amp; exports</h2></div>

      <div className="grid-2">
        {canPlantReports && <ReportGenerator equipment={equipment} />}
        {canShiftReport  && <ShiftReportCard username={user?.username} />}

        <div className="panel">
          <div className="card-head"><strong>Available report types</strong></div>
          <ul className="muted" style={{ lineHeight: 1.8 }}>
            {canPlantReports && <>
              <li><strong>Equipment (xlsx)</strong> — sensor readings + alarms + stats.</li>
              <li><strong>Equipment (pdf)</strong>  — 1-page executive summary + health index.</li>
              <li><strong>Alarms log (xlsx)</strong> — every alarm in range with ack info.</li>
              <li><strong>Plant summary (pdf)</strong> — KPIs, top offenders, AI findings.</li>
            </>}
            {canShiftReport && (
              <li><strong>My shift (pdf)</strong> — your notes, alarms, and assigned
                  work orders for the selected range.</li>
            )}
          </ul>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Reports are generated on-demand by the backend service and streamed as binary.
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

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
        `shift_${username || 'me'}_${fromIso.slice(0,10)}.pdf`);
    } catch (e) {
      setErr(e.response?.data?.message || 'Failed to generate PDF');
    } finally { setBusy(false); }
  };

  return (
    <div className="panel">
      <div className="card-head">
        <strong>My shift report</strong>
        <span className="pill">PDF</span>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Generate a personalised PDF containing the notes you wrote, the alarms
        raised and the work orders assigned to you in the selected range.
      </p>
      <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label>
          <span className="muted" style={{ fontSize: 12 }}>From</span>
          <input type="datetime-local" value={from}
                 onChange={e => setFrom(e.target.value)} />
        </label>
        <label>
          <span className="muted" style={{ fontSize: 12 }}>To</span>
          <input type="datetime-local" value={to}
                 onChange={e => setTo(e.target.value)} />
        </label>
      </div>
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: 12 }}>
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? 'Preparing…' : '📄 Generate shift PDF'}
        </button>
      </div>
    </div>
  );
}
