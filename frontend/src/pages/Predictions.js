/**
 * AI predictions console:
 *  - choose an equipment + sensor, run an anomaly prediction,
 *  - run a failure prediction for the equipment (next 7-14 days),
 *  - get the latest RUL.
 *
 * Shows a small history chart of past anomaly scores.
 */
import { useEffect, useMemo, useState } from 'react';
import { Equipment as EqApi, Predictions } from '../services/api';
import AnomalyDisplay from '../components/ML/AnomalyDisplay';
import RULIndicator  from '../components/ML/RULIndicator';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

export default function PredictionsPage() {
  const [equipment,    setEquipment]    = useState([]);
  const [equipmentId,  setEquipmentId]  = useState('');
  const [sensorId,     setSensorId]     = useState('');
  const [window,       setWindow]       = useState(30);
  const [horizon,      setHorizon]      = useState(7);
  const [anomaly,      setAnomaly]      = useState(null);
  const [anomalyHist,  setAnomalyHist]  = useState([]);
  const [failure,      setFailure]      = useState(null);
  const [rul,          setRul]          = useState(null);
  const [busy,         setBusy]         = useState(false);
  const [error,        setError]        = useState('');

  // Load equipment list once.
  useEffect(() => {
    EqApi.list().then((d) => {
      const items = d.items || d;
      setEquipment(items);
      if (items[0]) setEquipmentId(items[0].id);
    }).catch(e => setError(e.response?.data?.message || 'Failed to load equipment'));
  }, []);

  // Load sensors for the chosen equipment + default RUL.
  useEffect(() => {
    if (!equipmentId) return;
    EqApi.get(equipmentId).then(eq => {
      const first = eq.sensors?.[0];
      setSensorId(first ? first.id : '');
    });
    Predictions.rul(equipmentId).then(setRul).catch(() => setRul(null));
  }, [equipmentId]);

  // Refresh anomaly history when sensor changes.
  useEffect(() => {
    if (!sensorId) { setAnomalyHist([]); return; }
    Predictions.anomalyHistory(sensorId)
      .then(d => setAnomalyHist((d.items || d).map(i => ({
        ...i, t: new Date(i.created_at).toLocaleTimeString([], { hour12: false }),
      }))))
      .catch(() => setAnomalyHist([]));
  }, [sensorId]);

  const sensors = useMemo(() => {
    const eq = equipment.find(e => e.id === Number(equipmentId));
    return eq?.sensors || [];
  }, [equipment, equipmentId]);

  const runAnomaly = async () => {
    if (!sensorId) return;
    setBusy(true); setError('');
    try {
      const a = await Predictions.anomaly(Number(sensorId), Number(window));
      setAnomaly(a);
      const hist = await Predictions.anomalyHistory(sensorId);
      setAnomalyHist((hist.items || hist).map(i => ({
        ...i, t: new Date(i.created_at).toLocaleTimeString([], { hour12: false }),
      })));
    } catch (e) { setError(e.response?.data?.message || 'Anomaly prediction failed'); }
    finally   { setBusy(false); }
  };

  const runFailure = async () => {
    if (!equipmentId) return;
    setBusy(true); setError('');
    try {
      const f = await Predictions.failure(Number(equipmentId), Number(horizon));
      setFailure(f);
    } catch (e) { setError(e.response?.data?.message || 'Failure prediction failed'); }
    finally   { setBusy(false); }
  };

  return (
    <div>
      <div className="page-head">
        <h2>AI predictions</h2>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="grid-3">
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Equipment</span>
            <select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
              {equipment.map(e => (
                <option key={e.id} value={e.id}>{e.tag} — {e.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Sensor</span>
            <select value={sensorId} onChange={(e) => setSensorId(e.target.value)}>
              {sensors.map(s => (
                <option key={s.id} value={s.id}>{s.tag} — {s.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="muted" style={{ fontSize: 12 }}>Window (min)</span>
            <input type="number" min="5" max="120" value={window}
                   onChange={(e) => setWindow(e.target.value)} />
          </label>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button className="primary" onClick={runAnomaly} disabled={busy || !sensorId}>
            🔍 Detect anomaly
          </button>
          <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Horizon</span>
            <input type="number" min="1" max="30" value={horizon}
                   onChange={(e) => setHorizon(e.target.value)} style={{ width: 70 }} />
            <button className="primary" onClick={runFailure} disabled={busy || !equipmentId}>
              📈 Predict failure
            </button>
          </label>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <AnomalyDisplay result={anomaly} />
        <RULIndicator rul={rul} />
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <FailureCard failure={failure} />
        <div className="card">
          <div className="card-head">
            <strong>Anomaly score history</strong>
            <span className="muted" style={{ fontSize: 12 }}>last {anomalyHist.length} runs</span>
          </div>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={anomalyHist}>
                <CartesianGrid stroke="#1c2538" strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fill: '#7b8799', fontSize: 11 }} />
                <YAxis domain={[0, 1]} tick={{ fill: '#7b8799', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#121a2b', border: '1px solid #25314a' }} />
                <Line type="monotone" dataKey="score" stroke="#ffb04a"
                      strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function FailureCard({ failure }) {
  if (!failure) {
    return (
      <div className="card">
        <div className="card-head"><strong>Predictive maintenance</strong></div>
        <div className="muted" style={{ padding: 12 }}>
          Run a failure prediction to see the probability distribution across modes.
        </div>
      </div>
    );
  }
  const modes = failure.mode_probabilities || {};
  const sorted = Object.entries(modes).sort((a, b) => b[1] - a[1]);
  const overall = Math.round((Number(failure.failure_probability) || 0) * 100);
  const color   = overall > 60 ? '#ff5566' : overall > 30 ? '#ffb04a' : '#2cd08c';

  return (
    <div className="card">
      <div className="card-head">
        <strong>Predictive maintenance</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          horizon {failure.horizon_days} d
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 28, fontWeight: 600, color }}>{overall}%</div>
        <div className="muted" style={{ fontSize: 12 }}>overall failure probability</div>
      </div>
      <div style={{ marginTop: 10 }}>
        {sorted.map(([mode, p]) => (
          <div key={mode} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{mode}</span>
              <span className="muted">{Math.round(p * 100)}%</span>
            </div>
            <div className="meter"><div className="meter-fill"
                                        style={{ width: `${p * 100}%`, background: color }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
