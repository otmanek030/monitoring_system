/**
 * Predictions — AI predictions console (dark-themed).
 * Anomaly detection, failure prediction, RUL indicator.
 */
import { useEffect, useMemo, useState } from 'react';
import { Equipment as EqApi, Predictions } from '../services/api';
import AnomalyDisplay from '../components/ML/AnomalyDisplay';
import RULIndicator  from '../components/ML/RULIndicator';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const AXIS_TICK = { fill: 'var(--tm)', fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace" };

export default function PredictionsPage() {
  const [equipment,    setEquipment]    = useState([]);
  const [equipmentId,  setEquipmentId]  = useState('');
  const [sensorId,     setSensorId]     = useState('');
  const [windowMin,    setWindowMin]    = useState(30);
  const [horizon,      setHorizon]      = useState(7);
  const [anomaly,      setAnomaly]      = useState(null);
  const [anomalyHist,  setAnomalyHist]  = useState([]);
  const [failure,      setFailure]      = useState(null);
  const [rul,          setRul]          = useState(null);
  const [busy,         setBusy]         = useState(false);
  const [error,        setError]        = useState('');

  useEffect(() => {
    EqApi.list().then((d) => {
      const items = d.items || d;
      setEquipment(items);
      if (items[0]) setEquipmentId(items[0].id);
    }).catch(e => setError(e.response?.data?.message || 'Failed to load equipment'));
  }, []);

  useEffect(() => {
    if (!equipmentId) return;
    EqApi.get(equipmentId).then(eq => {
      const first = eq.sensors?.[0];
      setSensorId(first ? first.id : '');
    });
    Predictions.rul(equipmentId).then(setRul).catch(() => setRul(null));
  }, [equipmentId]);

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
      const a = await Predictions.anomaly(Number(sensorId), Number(windowMin));
      setAnomaly(a);
      const hist = await Predictions.anomalyHistory(sensorId);
      setAnomalyHist((hist.items || hist).map(i => ({
        ...i, t: new Date(i.created_at).toLocaleTimeString([], { hour12: false }),
      })));
    } catch (e) { setError(e.response?.data?.message || 'Anomaly prediction failed'); }
    finally    { setBusy(false); }
  };

  const runFailure = async () => {
    if (!equipmentId) return;
    setBusy(true); setError('');
    try {
      const f = await Predictions.failure(Number(equipmentId), Number(horizon));
      setFailure(f);
    } catch (e) { setError(e.response?.data?.message || 'Failure prediction failed'); }
    finally    { setBusy(false); }
  };

  return (
    <div>
      <div className="page-head">
        <h2>AI Predictions</h2>
        <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
          Anomaly detection · Predictive maintenance · RUL estimation
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {/* Controls panel */}
      <div className="panel" style={{ marginBottom: 10 }}>
        <div className="panel-head">
          <span className="title">Model Controls</span>
          {busy && <span style={{ fontSize: 10.5, color: 'var(--g)', marginLeft: 6 }}>Running…</span>}
          <span className="menu">⋯</span>
        </div>
        <div className="panel-body">
          <div className="grid-3" style={{ marginBottom: 12, gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 10.5, color: 'var(--tm)', fontWeight: 700, letterSpacing: .3, textTransform: 'uppercase' }}>Equipment</span>
              <select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)} style={{ width: '100%' }}>
                {equipment.map(e => (
                  <option key={e.id} value={e.id}>{e.tag} — {e.name}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 10.5, color: 'var(--tm)', fontWeight: 700, letterSpacing: .3, textTransform: 'uppercase' }}>Sensor</span>
              <select value={sensorId} onChange={(e) => setSensorId(e.target.value)} style={{ width: '100%' }}>
                {sensors.map(s => (
                  <option key={s.id} value={s.id}>{s.tag} — {s.name}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 10.5, color: 'var(--tm)', fontWeight: 700, letterSpacing: .3, textTransform: 'uppercase' }}>Window (min)</span>
              <input type="number" min="5" max="120" value={windowMin}
                onChange={(e) => setWindowMin(e.target.value)} style={{ width: '100%' }} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="primary" onClick={runAnomaly} disabled={busy || !sensorId}>
              Detect Anomaly
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>Horizon:</span>
              <input type="number" min="1" max="30" value={horizon}
                onChange={(e) => setHorizon(e.target.value)} style={{ width: 64 }} />
              <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>days</span>
              <button className="primary" onClick={runFailure} disabled={busy || !equipmentId}>
                Predict Failure
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Top row: anomaly + RUL */}
      <div className="grid-2" style={{ marginBottom: 10 }}>
        <AnomalyDisplay result={anomaly} />
        <RULIndicator rul={rul} />
      </div>

      {/* Bottom row: failure + anomaly history */}
      <div className="grid-2">
        <FailureCard failure={failure} />

        {/* Anomaly score history chart */}
        <div className="panel">
          <div className="panel-head">
            <span className="title">Anomaly Score History</span>
            <span style={{ fontSize: 10.5, color: 'var(--tm)', marginLeft: 4 }}>
              {anomalyHist.length} runs
            </span>
            <span className="menu">⋯</span>
          </div>
          <div style={{ flex: 1, minHeight: 180, padding: '8px 4px 4px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={anomalyHist} margin={{ top: 4, right: 20, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
                <YAxis domain={[0, 1]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
                <Tooltip
                  contentStyle={{
                    background: '#fff',
                    border: '1px solid var(--g-soft)',
                    color: 'var(--tx)', fontSize: 11.5, borderRadius: 5,
                    boxShadow: '0 2px 8px rgba(0,0,0,.08)',
                  }}
                  labelStyle={{ color: 'var(--tm)' }}
                />
                {/* Anomaly threshold line */}
                <Line
                  type="monotone" dataKey="score" stroke="var(--orange)"
                  strokeWidth={1.8} dot={false} isAnimationActive={false}
                />
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
      <div className="panel">
        <div className="panel-head">
          <span className="title">Predictive Maintenance</span>
          <span className="menu">⋯</span>
        </div>
        <div style={{ padding: '22px 16px', textAlign: 'center', color: 'var(--tm)', fontSize: 12.5 }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>📈</div>
          Run a failure prediction to see the probability distribution
        </div>
      </div>
    );
  }

  const modes   = failure.mode_probabilities || {};
  const sorted  = Object.entries(modes).sort((a, b) => b[1] - a[1]);
  const overall = Math.round((Number(failure.failure_probability) || 0) * 100);
  const color   = overall > 60 ? 'var(--red)' : overall > 30 ? 'var(--yellow)' : 'var(--g)';
  const barColor= overall > 60 ? 'var(--red)' : overall > 30 ? 'var(--yellow)' : 'var(--g)';

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">Predictive Maintenance</span>
        <span style={{ fontSize: 10.5, color: 'var(--tm)', marginLeft: 4 }}>
          horizon {failure.horizon_days}d
        </span>
        <span className="menu">⋯</span>
      </div>
      <div className="panel-body" style={{ gap: 10 }}>
        {/* Overall probability */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontSize: 34, fontWeight: 700, color,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: -1,
          }}>
            {overall}<span style={{ fontSize: 16, fontWeight: 400, color: 'var(--tm)', marginLeft: 2 }}>%</span>
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>overall failure probability</span>
        </div>

        {/* Mode breakdown */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 4 }}>
          {sorted.map(([mode, p]) => {
            const pct = Math.round(p * 100);
            return (
              <div key={mode}>
                <div className="bg-row">
                  <span className="bg-label">{mode}</span>
                  <div className="bg-track">
                    <div className="bg-fill" style={{ width: `${pct}%`, background: barColor }} />
                  </div>
                  <span className={`bg-val ${pct > 60 ? 'red' : pct > 30 ? 'yellow' : 'green'}`}>
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
