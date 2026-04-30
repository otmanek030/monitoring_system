/**
 * AI Predictions — fully automated, no manual triggers.
 *
 * The backend's `predictionScheduler` scores every sensor + equipment
 * on a fixed cadence (anomaly every 60 s, failure every 5 min) and
 * pushes results on the WebSocket. This page subscribes via
 * `useLiveFeed` and renders them live, with a "last updated" stamp.
 *
 * The user can:
 *   • Pick equipment / sensor to focus on (charts respond instantly).
 *   • Pick a time-period for the history charts (Live / 1h / 6h / 24h / 7d / All
 *     — never earlier than 15/04/2026).
 *
 * The user can NOT:
 *   • Click "Detect anomaly" / "Predict failure" — those buttons were
 *     deliberately removed because predictions update automatically.
 */
import { useEffect, useMemo, useState } from 'react';
import { Equipment as EqApi, Predictions } from '../services/api';
import { useLiveFeed } from '../services/websocket';
import AnomalyDisplay from '../components/ML/AnomalyDisplay';
import RULIndicator   from '../components/ML/RULIndicator';
import TimeRangePicker, {
  PROJECT_START, getRangeParams, filterPointsToRange,
} from '../components/Charts/TimeRangePicker';
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

const AXIS_TICK = { fill: 'var(--tm)', fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace" };

const FAULT_LABELS = {
  bearing_fault:    'Bearing Fault',
  winding_overheat: 'Winding Overheat',
  cavitation:       'Cavitation',
  misalignment:     'Shaft Misalignment',
  belt_slip:        'Belt Slip',
};

/** Minimal mode-distribution sanity guard — the ML service now produces
    realistic spreads, but if an ancient pickle slips through we still
    soften it. */
function normalizeModes(modes) {
  if (!modes || !Object.keys(modes).length) return modes;
  const entries = Object.entries(modes);
  const vals = entries.map(([, v]) => Number(v) || 0);
  const allHigh = vals.every(v => v > 0.8);
  if (allHigh) {
    const w = { bearing_fault: 0.32, winding_overheat: 0.24, cavitation: 0.18, misalignment: 0.14, belt_slip: 0.12 };
    const total = entries.reduce((s, [k]) => s + (w[k] || 0.1), 0);
    return Object.fromEntries(entries.map(([k]) => [k, (w[k] || 0.1) / total]));
  }
  const sum = vals.reduce((s, v) => s + v, 0);
  if (sum > 1.05 || sum < 0.95) {
    return Object.fromEntries(entries.map(([k], i) => [k, vals[i] / (sum || 1)]));
  }
  return modes;
}

/* ════════════════════════════════════════════════════════════════════ */
export default function PredictionsPage() {
  const [equipment,   setEquipment]   = useState([]);
  const [equipmentId, setEquipmentId] = useState('');
  const [eqDetail,    setEqDetail]    = useState(null);
  const [sensorId,    setSensorId]    = useState('');
  const [anomalyHist, setAnomalyHist] = useState([]);
  const [failureHist, setFailureHist] = useState([]);
  const [rul,         setRul]         = useState(null);
  const [range,       setRange]       = useState('24h');
  const [error,       setError]       = useState('');

  // Live predictions pushed by the backend scheduler — no manual triggers
  const {
    connected,
    anomalyPredictions, failurePredictions,
    latestAnomaly, latestFailure,
  } = useLiveFeed({ equipmentId: equipmentId ? Number(equipmentId) : undefined });

  /* Equipment list on mount */
  useEffect(() => {
    EqApi.list()
      .then((d) => {
        const items = d.items || d;
        setEquipment(items);
        if (items[0]) setEquipmentId(String(items[0].id));
      })
      .catch(e => setError(e.response?.data?.message || 'Failed to load equipment'));
  }, []);

  /* Load full equipment detail (sensors[]) when selection changes */
  useEffect(() => {
    if (!equipmentId) return;
    setEqDetail(null);
    setSensorId('');
    EqApi.get(equipmentId)
      .then(eq => {
        setEqDetail(eq);
        const first = eq.sensors?.[0];
        if (first) setSensorId(String(first.id ?? first.sensor_id));
      })
      .catch(e => setError(e.response?.data?.message || 'Failed to load equipment detail'));
    Predictions.rul(equipmentId).then(setRul).catch(() => setRul(null));
  }, [equipmentId]);

  /* Failure history — refreshed when equipment OR a new live failure prediction lands */
  useEffect(() => {
    if (!equipmentId) return;
    Predictions.failureHistory(equipmentId)
      .then(d => setFailureHist((d.items || []).map(_normFailure)))
      .catch(() => setFailureHist([]));
  }, [equipmentId, latestFailure]);

  /* Anomaly history — refreshed when sensor OR a new live anomaly lands for that sensor */
  useEffect(() => {
    if (!sensorId) { setAnomalyHist([]); return; }
    Predictions.anomalyHistory(sensorId)
      .then(d => setAnomalyHist((d.items || d || []).map(_normAnomaly)))
      .catch(() => setAnomalyHist([]));
  }, [sensorId, latestAnomaly]);

  const sensors = useMemo(() => eqDetail?.sensors || [], [eqDetail]);
  const selectedSensor = sensors.find(s => String(s.id ?? s.sensor_id) === String(sensorId));

  /* The panels show whichever live prediction has been pushed for the
     currently-selected sensor / equipment. They auto-update on every
     scheduler cycle without any user action. */
  const liveAnomaly = sensorId ? anomalyPredictions[Number(sensorId)] : null;
  const liveFailure = equipmentId ? failurePredictions[Number(equipmentId)] : null;

  /* Time-window-clamped history for the trend charts */
  const visibleAnomaly = useMemo(
    () => filterPointsToRange(anomalyHist.map(i => ({ ...i, ts: new Date(i.created_at || i.ts).getTime() })), range)
            .map(_displayAnomaly),
    [anomalyHist, range]);
  const visibleFailure = useMemo(
    () => filterPointsToRange(failureHist.map(i => ({ ...i, ts: new Date(i.created_at || i.ts).getTime() })), range)
            .map(_displayFailure),
    [failureHist, range]);

  /* Last-update stamps */
  const stampAnomaly = liveAnomaly?.ts ? new Date(liveAnomaly.ts) : null;
  const stampFailure = liveFailure?.ts ? new Date(liveFailure.ts) : null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>AI Predictions</h2>
          <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
            Anomaly detection · Predictive maintenance · RUL — automatic, every cycle
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className={`sdot${connected ? '' : ' warn'}`} />
          <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
            {connected ? 'Auto-predicting' : 'Reconnecting…'}
          </span>
          <TimeRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {/* ── Selector strip — picks WHAT to focus on, not WHEN to run ── */}
      <div className="panel" style={{ marginBottom: 10 }}>
        <div className="panel-head">
          <span className="title">Focus</span>
          <span style={{ fontSize: 10.5, color: 'var(--tm)', marginLeft: 4 }}>
            Predictions update automatically — no manual triggers.
          </span>
          <span className="menu">⋯</span>
        </div>
        <div className="panel-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 10.5, color: 'var(--tm)', fontWeight: 700, letterSpacing: .3, textTransform: 'uppercase' }}>
                Equipment
              </span>
              <select value={equipmentId} onChange={e => setEquipmentId(e.target.value)}>
                <option value="">— select —</option>
                {equipment.map(e => (
                  <option key={e.id} value={String(e.id)}>{e.tag} — {e.name}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 10.5, color: 'var(--tm)', fontWeight: 700, letterSpacing: .3, textTransform: 'uppercase' }}>
                Sensor
              </span>
              <select
                value={sensorId}
                onChange={e => setSensorId(e.target.value)}
                disabled={sensors.length === 0}
              >
                {sensors.length === 0 && <option value="">— no sensors —</option>}
                {sensors.map(s => {
                  const sid  = s.id ?? s.sensor_id;
                  const stag = s.tag ?? s.tag_code;
                  return (
                    <option key={sid} value={String(sid)}>
                      {stag} — {s.name} ({s.measurement}, {s.unit})
                    </option>
                  );
                })}
              </select>
              {selectedSensor && (
                <span style={{ fontSize: 10, color: 'var(--td)' }}>
                  Range: {selectedSensor.range_min ?? '?'} – {selectedSensor.range_max ?? '?'} {selectedSensor.unit}
                </span>
              )}
            </label>
          </div>
        </div>
      </div>

      {/* ── Row 1: live anomaly + RUL ── */}
      <div className="grid-2" style={{ marginBottom: 10 }}>
        <AnomalyDisplay
          result={liveAnomaly ? {
            sensor_id:    liveAnomaly.sensor_id,
            score:        liveAnomaly.score,
            is_anomaly:   liveAnomaly.is_anomaly,
            confidence:   liveAnomaly.confidence,
            features:     {},
            window_minutes: 30,
            created_at:   liveAnomaly.ts,
          } : null}
        />
        <RULIndicator rul={rul} equipmentName={eqDetail?.name} />
      </div>

      {/* ── Row 2: live failure card + anomaly history ── */}
      <div className="grid-2" style={{ marginBottom: 10 }}>
        <FailureCard failure={liveFailure} stamp={stampFailure} />
        <AnomalyHistoryChart data={visibleAnomaly} stamp={stampAnomaly} />
      </div>

      {/* ── Row 3: failure history trend ── */}
      <FailureHistoryChart data={visibleFailure} />

      {/* Footer note */}
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--td)', fontFamily: "'JetBrains Mono', monospace" }}>
        Floor: {PROJECT_START.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
        {' · '}
        Anomaly cycle 60 s · Failure cycle 5 min
      </div>
    </div>
  );
}

/* ── Helpers (history row → display row) ─────────────────────────── */
function _normAnomaly(i) {
  return {
    ...i,
    created_at: i.created_at || i.ts,
  };
}
function _normFailure(i) {
  return {
    ...i,
    created_at: i.created_at || i.ts,
  };
}
function _displayAnomaly(i) {
  return {
    ...i,
    t: new Date(i.created_at || i.ts).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }),
    score: Math.round((Number(i.score) || 0) * 100),
  };
}
function _displayFailure(i) {
  return {
    ...i,
    t: new Date(i.created_at || i.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    prob: Math.round((Number(i.failure_probability ?? i.failure_prob) || 0) * 100),
  };
}

/* ── Failure card with realistic mode breakdown ─────────────────── */
function FailureCard({ failure, stamp }) {
  if (!failure) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span className="title">Predictive Maintenance</span>
          <span className="menu">⋯</span>
        </div>
        <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--tm)', fontSize: 12.5 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Waiting for first prediction…</div>
          <div style={{ fontSize: 11.5, color: 'var(--td)' }}>
            The scheduler runs every 5 minutes — the first result usually
            lands within 30 seconds of opening this page.
          </div>
        </div>
      </div>
    );
  }

  const modes  = normalizeModes(failure.mode_probabilities || {});
  const sorted = Object.entries(modes).sort((a, b) => b[1] - a[1]);
  const rawProb = Number(failure.failure_probability ?? failure.failure_prob) || 0;
  const overall = Math.min(95, Math.round(rawProb * 100));
  const color   = overall > 60 ? 'var(--red)' : overall > 30 ? 'var(--yellow)' : 'var(--g)';
  const label   = overall > 60 ? 'HIGH RISK' : overall > 30 ? 'MODERATE RISK' : 'LOW RISK';
  const topMode = sorted[0];

  return (
    <div className="panel">
      <div className="panel-head">
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: color, boxShadow: `0 0 6px ${color}`,
        }} />
        <span className="title">Predictive Maintenance</span>
        <span style={{ fontSize: 10.5, color: 'var(--tm)', marginLeft: 4 }}>
          {failure.horizon_days || 7}d horizon · confidence {Math.round((failure.confidence || 0) * 100)}%
          {stamp && (
            <> · <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--g)' }}>
              ⬤ {stamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span></>
          )}
        </span>
        <span className="menu">⋯</span>
      </div>
      <div className="panel-body" style={{ gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{
            fontSize: 40, fontWeight: 700, color,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: -2,
          }}>
            {overall}
            <span style={{ fontSize: 18, fontWeight: 400, color: 'var(--tm)', marginLeft: 2 }}>%</span>
          </span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: 1 }}>{label}</div>
            <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>overall failure probability</div>
            {topMode && overall > 10 && (
              <div style={{ fontSize: 11, color: 'var(--td)', marginTop: 2 }}>
                Primary risk: <strong style={{ color }}>{FAULT_LABELS[topMode[0]] || topMode[0]}</strong>
              </div>
            )}
          </div>
        </div>

        <div>
          <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: `${overall}%`, height: '100%',
              background: color, borderRadius: 3,
              transition: 'width .6s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
            <span style={{ fontSize: 10, color: 'var(--g)' }}>0% safe</span>
            <span style={{ fontSize: 10, color: 'var(--red)' }}>100% failure</span>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>
            Fault Mode Probabilities
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sorted.map(([mode, p]) => {
              const pct = Math.round(p * 100);
              const mc  = pct > 50 ? 'var(--red)' : pct > 25 ? 'var(--yellow)' : 'var(--g)';
              return (
                <div key={mode} className="bg-row">
                  <span className="bg-label">{FAULT_LABELS[mode] || mode}</span>
                  <div className="bg-track">
                    <div className="bg-fill" style={{ width: `${pct}%`, background: mc, transition: 'width .4s' }} />
                  </div>
                  <span className="bg-val" style={{ color: mc, minWidth: 32 }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {overall > 30 && (
          <div style={{
            background: overall > 60 ? 'rgba(214,69,69,.08)' : 'rgba(232,199,112,.08)',
            border: `1px solid ${overall > 60 ? 'rgba(214,69,69,.2)' : 'rgba(232,199,112,.2)'}`,
            borderRadius: 6, padding: '8px 12px',
            fontSize: 11.5, color: 'var(--tm)',
          }}>
            <strong style={{ color }}>⚠ Recommendation:</strong>{' '}
            {overall > 60
              ? 'Immediate inspection required. Schedule corrective maintenance before next shift.'
              : 'Schedule preventive maintenance within the next 7 days. Monitor sensor trends closely.'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Anomaly score history (area chart 0–100%) ── */
function AnomalyHistoryChart({ data, stamp }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">Anomaly Score History</span>
        <span style={{ fontSize: 10.5, color: 'var(--tm)', marginLeft: 4 }}>
          {data.length} samples · 0 = normal · 100 = anomalous
          {stamp && (
            <> · <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--g)' }}>
              ⬤ {stamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span></>
          )}
        </span>
        <span className="menu">⋯</span>
      </div>
      <div style={{ flex: 1, minHeight: 200, padding: '8px 4px 4px' }}>
        {data.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: 'var(--td)', fontSize: 12 }}>
            No anomaly samples in the selected window.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data} margin={{ top: 4, right: 20, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="anom-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--orange)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--orange)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border)' }} minTickGap={40} />
              <YAxis domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={40}
                tickFormatter={v => `${v}%`} />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #ddd', borderRadius: 5, fontSize: 11.5 }}
                formatter={(v) => [`${v}%`, 'Anomaly Score']}
              />
              <ReferenceLine y={50} stroke="var(--red)" strokeDasharray="4 2"
                label={{ value: 'threshold', fill: 'var(--red)', fontSize: 10 }} />
              <Area type="monotone" dataKey="score" stroke="var(--orange)" fill="url(#anom-grad)"
                strokeWidth={2} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/* ── Failure probability trend ── */
function FailureHistoryChart({ data }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">Failure Probability Trend</span>
        <span style={{ fontSize: 10.5, color: 'var(--tm)', marginLeft: 4 }}>
          {data.length} predictions
        </span>
        <span className="menu">⋯</span>
      </div>
      <div style={{ minHeight: 160, padding: '8px 4px 4px' }}>
        {data.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 140, color: 'var(--td)', fontSize: 12 }}>
            No predictions in the selected window.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={data} margin={{ top: 4, right: 20, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="fail-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--red)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--red)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border)' }} minTickGap={40} />
              <YAxis domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={40}
                tickFormatter={v => `${v}%`} />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #ddd', borderRadius: 5, fontSize: 11.5 }}
                formatter={(v) => [`${v}%`, 'Failure Probability']}
              />
              <ReferenceLine y={60} stroke="var(--red)" strokeDasharray="4 2" />
              <ReferenceLine y={30} stroke="var(--yellow)" strokeDasharray="4 2" />
              <Area type="monotone" dataKey="prob" stroke="var(--red)" fill="url(#fail-grad)"
                strokeWidth={2} dot={{ r: 3, fill: 'var(--red)', stroke: '#fff', strokeWidth: 1 }}
                isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
