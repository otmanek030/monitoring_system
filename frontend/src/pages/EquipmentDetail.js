/**
 * Live page for a single equipment: all sensors, one chart per sensor,
 * plus inline AI predictions (anomaly + RUL) and recent alarms.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Equipment as EqApi, Predictions, Alarms, Sensors } from '../services/api';
import { useLiveFeed } from '../services/websocket';
import RealTimeChart from '../components/Dashboard/RealTimeChart';
import AnomalyDisplay from '../components/ML/AnomalyDisplay';
import RULIndicator  from '../components/ML/RULIndicator';
import ExportButton  from '../components/Reports/ExportButton';
import { Reports }   from '../services/api';
import { useAuth }   from '../contexts/AuthContext';

export default function EquipmentDetail() {
  const { id } = useParams();
  const eqId = Number(id);
  const { can } = useAuth();

  const [equipment, setEquipment] = useState(null);
  const [alarms,    setAlarms]    = useState([]);
  const [anomaly,   setAnomaly]   = useState(null);
  const [rul,       setRul]       = useState(null);
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState('');
  const histLoadedRef = useRef(false);

  const { readings, connected, seedHistorical } = useLiveFeed({ equipmentId: eqId });

  useEffect(() => {
    let active = true;
    Promise.all([
      EqApi.get(eqId),
      Alarms.list({ equipment_id: eqId, limit: 20 }),
      Predictions.rul(eqId).catch(() => null),
    ]).then(([eq, al, r]) => {
      if (!active) return;
      setEquipment(eq);
      setAlarms(al.items || al);
      setRul(r);
    }).catch(e => setError(e.response?.data?.message || 'Failed to load'));
    return () => { active = false; };
  }, [eqId]);

  // Pre-populate charts with the last 5 minutes of historical readings.
  useEffect(() => {
    if (!equipment?.sensors?.length || histLoadedRef.current) return;
    histLoadedRef.current = true;

    const from = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    Promise.all(
      equipment.sensors.map(s =>
        Sensors.readings(s.id, { from, bucket: 'raw', limit: 500 })
          .then(res => ({ id: s.id, points: res.points || [] }))
          .catch(() => ({ id: s.id, points: [] }))
      )
    ).then(results => {
      const hist = {};
      for (const { id: sid, points } of results) {
        hist[sid] = points.map(p => ({ ts: p.ts, value: Number(p.value) }));
      }
      seedHistorical(hist);
    });
  }, [equipment, seedHistorical]);

  const runPredictions = async () => {
    if (!equipment?.sensors?.length) return;
    setBusy(true);
    try {
      // Anomaly on the first sensor as a demo (the Predictions page is the full UX).
      const a = await Predictions.anomaly(equipment.sensors[0].id, 30);
      setAnomaly(a);
      const r = await Predictions.rul(eqId);
      setRul(r);
    } catch (e) {
      setError(e.response?.data?.message || 'Prediction failed');
    } finally {
      setBusy(false);
    }
  };

  if (!equipment) return <div className="muted">Loading…</div>;

  const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19);
  const to   = new Date().toISOString().slice(0, 19);

  return (
    <div>
      <div className="page-head">
        <h2>
          <Link to="/equipment" className="ghost small">← Equipment</Link>{' '}
          <code>{equipment.tag}</code> · {equipment.name}
        </h2>
        <span className={`badge ${connected ? 'ok' : 'bad'}`}>
          {connected ? '● live' : '○ offline'}
        </span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <InfoBox label="Status"   value={equipment.status} />
        <InfoBox label="Area"     value={equipment.area_code || '--'} />
        <InfoBox label="Type"     value={equipment.type_name || '--'} />
      </div>

      <div className="grid-2">
        {(equipment.sensors || []).map(s => (
          <RealTimeChart
            key={s.id}
            title={`${s.tag} · ${s.name}`}
            unit={s.unit || ''}
            data={readings[s.id] || []}
            thresholds={{ h1: s.h1, h2: s.h2, l1: s.l1, l2: s.l2 }}
          />
        ))}
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <AnomalyDisplay result={anomaly} />
        <RULIndicator rul={rul} />
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {can('predictions', 'r') && (
          <button className="primary" onClick={runPredictions} disabled={busy}>
            {busy ? 'Running…' : '🤖 Run AI predictions'}
          </button>
        )}
        {can('reports', 'r') && (
          <>
            <ExportButton url={Reports.equipmentXlsxUrl(eqId, from, to)}
                          filename={`${equipment.tag}_24h.xlsx`} label="Excel (24h)" />
            <ExportButton url={Reports.equipmentPdfUrl(eqId, from, to)}
                          filename={`${equipment.tag}_24h.pdf`} label="PDF (24h)" />
          </>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head"><strong>Recent alarms</strong></div>
          <table className="table">
            <thead>
              <tr><th>Severity</th><th>Message</th><th>Opened</th><th>Closed</th></tr>
            </thead>
            <tbody>
              {alarms.length ? alarms.map(a => (
                <tr key={a.id}>
                  <td>{a.severity}</td>
                  <td>{a.message}</td>
                  <td className="muted">{new Date(a.opened_at).toLocaleString()}</td>
                  <td className="muted">{a.closed_at ? new Date(a.closed_at).toLocaleString() : '—'}</td>
                </tr>
              )) : (
                <tr><td colSpan="4" className="muted" style={{ textAlign: 'center', padding: 18 }}>
                  No alarms recorded.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InfoBox({ label, value }) {
  return (
    <div className="card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: '#e8eefc', fontSize: 20 }}>{value}</div>
    </div>
  );
}
