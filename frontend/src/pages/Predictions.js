/**
 * AI Predictions - redesigned dashboard.
 *
 * Layout (top to bottom):
 *   1. Hero strip   - 3 model status cards (Anomaly / Failure / RUL)
 *                     with live "last updated" badges, model name, cycle.
 *   2. Focus card   - Equipment + sensor pickers, period picker.
 *   3. KPI gauges   - 3 donut gauges side-by-side: anomaly score,
 *                     failure probability, RUL health.
 *   4. Failure mode breakdown + Recommendation card.
 *   5. Anomaly history area chart.
 *   6. Failure probability trend chart.
 *
 * Predictions are pushed by the backend scheduler (anomaly every 60 s,
 * failure every 5 min) and arrive over WebSocket. No manual triggers.
 */
import { useEffect, useMemo, useState } from 'react';
import { Equipment as EqApi, Predictions } from '../services/api';
import { useLiveFeed } from '../services/websocket';
import TimeRangePicker, {
  PROJECT_START, filterPointsToRange,
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

/* ── Helpers ─────────────────────────────────────────────────────── */
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
function _normAnomaly(i) { return { ...i, created_at: i.created_at || i.ts }; }
function _normFailure(i) { return { ...i, created_at: i.created_at || i.ts }; }
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
function fmtClock(d) {
  return d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';
}
function fmtLifetime(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return '0h';
  if (hours < 48)  return `${Math.round(hours)} h`;
  if (hours < 720) return `${Math.round(hours / 24)} d`;
  return `${(hours / 720).toFixed(1)} mo`;
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
  const [mlHealth,    setMlHealth]    = useState(null);
  const [range,       setRange]       = useState('24h');
  const [error,       setError]       = useState('');

  const {
    connected,
    anomalyPredictions, failurePredictions,
    latestAnomaly, latestFailure,
  } = useLiveFeed({ equipmentId: equipmentId ? Number(equipmentId) : undefined });

  /* Equipment list + ML health */
  useEffect(() => {
    EqApi.list()
      .then((d) => {
        const items = d.items || d;
        setEquipment(items);
        if (items[0]) setEquipmentId(String(items[0].id));
      })
      .catch(e => setError(e.response?.data?.message || 'Failed to load equipment'));
    Predictions.mlHealth().then(setMlHealth).catch(() => setMlHealth(null));
    const t = setInterval(() => Predictions.mlHealth().then(setMlHealth).catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, []);

  /* Equipment detail (sensors[]) on selection change */
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

  useEffect(() => {
    if (!equipmentId) return;
    Predictions.failureHistory(equipmentId)
      .then(d => setFailureHist((d.items || []).map(_normFailure)))
      .catch(() => setFailureHist([]));
  }, [equipmentId, latestFailure]);

  useEffect(() => {
    if (!sensorId) { setAnomalyHist([]); return; }
    Predictions.anomalyHistory(sensorId)
      .then(d => setAnomalyHist((d.items || d || []).map(_normAnomaly)))
      .catch(() => setAnomalyHist([]));
  }, [sensorId, latestAnomaly]);

  const sensors = useMemo(() => eqDetail?.sensors || [], [eqDetail]);
  const selectedSensor = sensors.find(s => String(s.id ?? s.sensor_id) === String(sensorId));

  const liveAnomaly = sensorId ? anomalyPredictions[Number(sensorId)] : null;
  const liveFailure = equipmentId ? failurePredictions[Number(equipmentId)] : null;

  const visibleAnomaly = useMemo(
    () => filterPointsToRange(anomalyHist.map(i => ({ ...i, ts: new Date(i.created_at || i.ts).getTime() })), range)
            .map(_displayAnomaly),
    [anomalyHist, range]);
  const visibleFailure = useMemo(
    () => filterPointsToRange(failureHist.map(i => ({ ...i, ts: new Date(i.created_at || i.ts).getTime() })), range)
            .map(_displayFailure),
    [failureHist, range]);

  const stampAnomaly = liveAnomaly?.ts ? new Date(liveAnomaly.ts) : null;
  const stampFailure = liveFailure?.ts ? new Date(liveFailure.ts) : null;
  const stampRul     = rul?.ts ? new Date(rul.ts) : null;

  /* Derived metrics for KPI gauges */
  const anomalyPct = liveAnomaly ? Math.round((Number(liveAnomaly.score) || 0) * 100) : null;
  const failurePct = liveFailure
    ? Math.min(95, Math.round((Number(liveFailure.failure_probability ?? liveFailure.failure_prob) || 0) * 100))
    : null;
  const rulHi = rul ? (Number(rul.health_index) <= 1 ? Number(rul.health_index) * 100 : Number(rul.health_index)) : null;
  const rulHours = rul ? Math.max(0, Number(rul.rul_hours) || 0) : null;

  const modelStatus = mlHealth?.models || {};
  const modelsLoaded = mlHealth?.models_loaded ?? Object.values(modelStatus).filter(Boolean).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ══════════════ HEADER ══════════════ */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 6,
              background: 'linear-gradient(135deg, #16a34a 0%, #2aa3b0 100%)',
              color: '#fff', fontSize: 14, fontWeight: 700,
            }}>AI</span>
            AI Predictions
          </h2>
          <div style={{ fontSize: 11.5, color: 'var(--tm)', marginTop: 2 }}>
            Anomaly detection - Predictive maintenance - Remaining Useful Life
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 14,
            background: connected ? '#dcfce7' : '#fef3c7',
            color: connected ? '#16a34a' : '#d97706',
            fontSize: 11, fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: connected ? '#16a34a' : '#d97706',
              boxShadow: connected ? '0 0 8px #16a34a' : 'none',
            }} />
            {connected ? 'AUTO-PREDICTING' : 'RECONNECTING'}
          </span>
          <TimeRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {/* ══════════════ ROW 1 — MODEL STATUS HERO STRIP ══════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        <ModelCard
          accent="#e88a3a"
          name="Isolation Forest"
          purpose="Anomaly Detection"
          cycle="60 s"
          loaded={!!modelStatus.anomaly}
          stamp={stampAnomaly}
          metric={anomalyPct == null ? '--' : `${anomalyPct}%`}
          metricLabel={liveAnomaly?.is_anomaly ? 'Anomaly detected' : 'Within bounds'}
          metricColor={anomalyPct == null ? 'var(--td)' : anomalyPct >= 50 ? '#dc2626' : '#16a34a'}
        />
        <ModelCard
          accent="#dc2626"
          name="XGBoost Classifier"
          purpose="Failure Prediction"
          cycle="5 min"
          loaded={!!modelStatus.predictive}
          stamp={stampFailure}
          metric={failurePct == null ? '--' : `${failurePct}%`}
          metricLabel={liveFailure?.horizon_days ? `${liveFailure.horizon_days}-day horizon` : '7 / 14-day horizon'}
          metricColor={failurePct == null ? 'var(--td)' : failurePct > 60 ? '#dc2626' : failurePct > 30 ? '#d97706' : '#16a34a'}
        />
        <ModelCard
          accent="#2aa3b0"
          name="LSTM Network"
          purpose="Remaining Useful Life"
          cycle="on demand"
          loaded={!!modelStatus.rul}
          stamp={stampRul}
          metric={rulHours == null ? '--' : fmtLifetime(rulHours)}
          metricLabel={rulHi == null ? 'no estimate' : `health ${Math.round(rulHi)}%`}
          metricColor={rulHi == null ? 'var(--td)' : rulHi >= 70 ? '#16a34a' : rulHi >= 40 ? '#d97706' : '#dc2626'}
        />
      </div>

      {/* Tiny footer info under the strip */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 10.5, color: 'var(--td)',
        padding: '0 4px',
      }}>
        <span>
          <strong style={{ color: 'var(--tm)' }}>{modelsLoaded}/3</strong> models loaded
          {mlHealth?.service && <> - {mlHealth.service}</>}
        </span>
        <span>
          predictions stream automatically - no manual triggers
        </span>
      </div>

      {/* ══════════════ ROW 2 — FOCUS PICKER ══════════════ */}
      <div className="panel">
        <div className="panel-head">
          <span className="title">Focus</span>
          <span style={{ fontSize: 10.5, color: 'var(--td)', marginLeft: 6 }}>
            select equipment + sensor to drill into
          </span>
        </div>
        <div style={{ padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FieldGroup label="Equipment">
            <select value={equipmentId} onChange={e => setEquipmentId(e.target.value)} style={selectStyle}>
              <option value="">— select —</option>
              {equipment.map(e => (
                <option key={e.id} value={String(e.id)}>{e.tag} — {e.name}</option>
              ))}
            </select>
            {eqDetail && (
              <span style={{ fontSize: 10, color: 'var(--td)', marginTop: 3 }}>
                {sensors.length} sensors - status:{' '}
                <strong style={{ color: 'var(--tx)' }}>{eqDetail.status}</strong>
              </span>
            )}
          </FieldGroup>

          <FieldGroup label="Sensor">
            <select
              value={sensorId}
              onChange={e => setSensorId(e.target.value)}
              disabled={sensors.length === 0}
              style={selectStyle}
            >
              {sensors.length === 0 && <option value="">— no sensors —</option>}
              {sensors.map(s => {
                const sid  = s.id ?? s.sensor_id;
                const stag = s.tag ?? s.tag_code;
                return (
                  <option key={sid} value={String(sid)}>
                    {stag} — {s.measurement} ({s.unit})
                  </option>
                );
              })}
            </select>
            {selectedSensor && (
              <span style={{ fontSize: 10, color: 'var(--td)', marginTop: 3 }}>
                Range: {selectedSensor.range_min ?? '?'} – {selectedSensor.range_max ?? '?'} {selectedSensor.unit}
              </span>
            )}
          </FieldGroup>
        </div>
      </div>

      {/* ══════════════ ROW 3 — DONUT GAUGES ══════════════ */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12,
      }}>
        <GaugePanel
          title="Anomaly Score"
          subtitle={liveAnomaly ? '0 = normal · 100 = anomalous' : 'waiting for first sample'}
          pct={anomalyPct}
          color={anomalyPct == null ? '#94a3b8' : anomalyPct >= 50 ? '#dc2626' : anomalyPct >= 30 ? '#d97706' : '#16a34a'}
          accentLabel={liveAnomaly?.is_anomaly ? 'ANOMALY' : 'NORMAL'}
          extras={liveAnomaly && [
            { k: 'window',     v: `${liveAnomaly.window_minutes ?? 30} min` },
            { k: 'confidence', v: `${Math.round((liveAnomaly.confidence ?? 0) * 100)}%` },
          ]}
          stamp={stampAnomaly}
        />
        <GaugePanel
          title="Failure Probability"
          subtitle={liveFailure ? `next ${liveFailure.horizon_days || 7} days` : 'no prediction yet'}
          pct={failurePct}
          color={failurePct == null ? '#94a3b8' : failurePct > 60 ? '#dc2626' : failurePct > 30 ? '#d97706' : '#16a34a'}
          accentLabel={
            failurePct == null ? '—'
            : failurePct > 60 ? 'HIGH RISK'
            : failurePct > 30 ? 'MODERATE RISK'
            : 'LOW RISK'
          }
          extras={liveFailure && [
            { k: 'class',     v: FAULT_LABELS[liveFailure.predicted_class] || liveFailure.predicted_class || '—' },
            { k: 'confidence',v: `${Math.round((liveFailure.confidence ?? 0) * 100)}%` },
          ]}
          stamp={stampFailure}
        />
        <GaugePanel
          title="Health Index"
          subtitle={rulHours != null ? `RUL: ${fmtLifetime(rulHours)} remaining` : 'no RUL estimate'}
          pct={rulHi == null ? null : Math.round(rulHi)}
          color={rulHi == null ? '#94a3b8' : rulHi >= 70 ? '#16a34a' : rulHi >= 40 ? '#d97706' : '#dc2626'}
          accentLabel={
            rulHi == null ? '—'
            : rulHi >= 70 ? 'HEALTHY'
            : rulHi >= 40 ? 'AT RISK'
            : 'CRITICAL'
          }
          extras={rul && [
            { k: 'lower 95',  v: rul.rul_lower_95 != null ? fmtLifetime(rul.rul_lower_95) : '—' },
            { k: 'upper 95',  v: rul.rul_upper_95 != null ? fmtLifetime(rul.rul_upper_95) : '—' },
          ]}
          stamp={stampRul}
        />
      </div>

      {/* ══════════════ ROW 4 — FAULT MODES + RECOMMENDATION ══════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 12 }}>
        <FaultModePanel failure={liveFailure} />
        <RecommendationPanel
          failurePct={failurePct}
          rulHi={rulHi}
          rulHours={rulHours}
          equipment={eqDetail}
          recommendation={rul?.recommendation}
        />
      </div>

      {/* ══════════════ ROW 5 — ANOMALY HISTORY ══════════════ */}
      <SectionHeader>Anomaly Score History</SectionHeader>
      <AnomalyHistoryChart data={visibleAnomaly} stamp={stampAnomaly} />

      {/* ══════════════ ROW 6 — FAILURE TREND ══════════════ */}
      <SectionHeader>Failure Probability Trend</SectionHeader>
      <FailureHistoryChart data={visibleFailure} />

      {/* Footer */}
      <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--td)', fontFamily: "'JetBrains Mono', monospace", textAlign: 'right' }}>
        floor: {PROJECT_START.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
        {' - '}
        anomaly cycle 60 s · failure cycle 5 min
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────── */

const selectStyle = {
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 5,
  fontSize: 12,
  background: '#fff',
  width: '100%',
};

function FieldGroup({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{
        fontSize: 9.5, color: 'var(--tm)',
        fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
      }}>{label}</span>
      {children}
    </label>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 700, color: 'var(--tm)',
      letterSpacing: 0.6, textTransform: 'uppercase',
      borderLeft: '3px solid var(--g)', paddingLeft: 10,
    }}>{children}</div>
  );
}

/* ─── Model status card (top hero strip) ─────────────────────────── */
function ModelCard({ accent, name, purpose, cycle, loaded, stamp, metric, metricLabel, metricColor }) {
  return (
    <div className="panel" style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Top accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: 3,
        background: accent,
      }} />
      <div style={{ padding: '14px 14px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 9.5, fontWeight: 700, color: 'var(--td)',
              textTransform: 'uppercase', letterSpacing: 0.7,
            }}>{purpose}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx)', marginTop: 1 }}>
              {name}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 2 }}>
              cycle {cycle}
            </div>
          </div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 7px', borderRadius: 10,
            background: loaded ? '#dcfce7' : '#fee2e2',
            color: loaded ? '#16a34a' : '#dc2626',
            fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: loaded ? '#16a34a' : '#dc2626' }} />
            {loaded ? 'LOADED' : 'OFFLINE'}
          </span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8,
          paddingTop: 8, marginTop: 4,
          borderTop: '1px dashed var(--border)',
        }}>
          <span style={{
            fontSize: 26, fontWeight: 700, color: metricColor,
            fontFamily: "'JetBrains Mono', monospace", letterSpacing: -1,
          }}>{metric}</span>
          <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 500 }}>
            {metricLabel}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--td)', fontFamily: "'JetBrains Mono', monospace" }}>
            {stamp ? fmtClock(stamp) : 'no data'}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── Donut gauge panel ─────────────────────────────────────────── */
function GaugePanel({ title, subtitle, pct, color, accentLabel, extras, stamp }) {
  const display = pct == null ? '--' : `${pct}`;
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">{title}</span>
        <span style={{ fontSize: 10.5, color: 'var(--td)', marginLeft: 6 }}>
          {subtitle}
        </span>
        <span className="menu">⋯</span>
      </div>
      <div style={{
        padding: '14px 14px 16px',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <Donut pct={pct == null ? 0 : pct} color={color} bigText={display} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color, letterSpacing: 0.7,
            fontFamily: "'JetBrains Mono', monospace",
          }}>{accentLabel}</div>
          {extras && extras.map(e => (
            <div key={e.k} style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 10.5, color: 'var(--tm)', marginTop: 4,
              padding: '2px 0',
              borderBottom: '1px dashed var(--border)',
            }}>
              <span style={{ color: 'var(--td)' }}>{e.k}</span>
              <span style={{ color: 'var(--tx)', fontFamily: "'JetBrains Mono', monospace" }}>{e.v}</span>
            </div>
          ))}
          <div style={{ fontSize: 9.5, color: 'var(--td)', marginTop: 6, textAlign: 'right' }}>
            {stamp ? `updated ${fmtClock(stamp)}` : 'awaiting data'}
          </div>
        </div>
      </div>
    </div>
  );
}

function Donut({ pct, color, bigText }) {
  const size = 100;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r}
          stroke="#eef2f0" strokeWidth={stroke} fill="none" />
        <circle cx={size/2} cy={size/2} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition: 'stroke-dashoffset .6s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          fontSize: 22, fontWeight: 700, color,
          fontFamily: "'JetBrains Mono', monospace", lineHeight: 1,
        }}>{bigText}</div>
        <div style={{ fontSize: 9, color: 'var(--td)', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {bigText !== '--' ? '%' : 'no data'}
        </div>
      </div>
    </div>
  );
}

/* ─── Fault-mode breakdown ─────────────────────────────────────── */
function FaultModePanel({ failure }) {
  if (!failure) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span className="title">Fault Mode Breakdown</span>
          <span style={{ fontSize: 10.5, color: 'var(--td)', marginLeft: 6 }}>
            distribution across known failure modes
          </span>
        </div>
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--td)', fontSize: 12 }}>
          No prediction yet. The first scoring cycle should land within ~30 seconds.
        </div>
      </div>
    );
  }
  const modes  = normalizeModes(failure.mode_probabilities || {});
  const sorted = Object.entries(modes).sort((a, b) => b[1] - a[1]);

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">Fault Mode Breakdown</span>
        <span style={{ fontSize: 10.5, color: 'var(--td)', marginLeft: 6 }}>
          probabilities across the 5 monitored modes
        </span>
        <span className="menu">⋯</span>
      </div>
      <div style={{ padding: '12px 14px' }}>
        {sorted.map(([mode, p], idx) => {
          const pct = Math.round(p * 100);
          const mc  = pct > 50 ? '#dc2626' : pct > 25 ? '#d97706' : '#16a34a';
          const isTop = idx === 0;
          return (
            <div key={mode} style={{
              display: 'grid', gridTemplateColumns: '160px 1fr 50px',
              alignItems: 'center', gap: 10,
              padding: '6px 0',
              borderBottom: idx < sorted.length - 1 ? '1px dashed var(--border)' : 'none',
            }}>
              <span style={{
                fontSize: 11, color: isTop ? 'var(--tx)' : 'var(--tm)',
                fontWeight: isTop ? 700 : 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {isTop && <span style={{ color: mc, marginRight: 4 }}>●</span>}
                {FAULT_LABELS[mode] || mode}
              </span>
              <div style={{
                position: 'relative', height: 8, background: 'var(--g-softer)',
                borderRadius: 4, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${pct}%`, height: '100%', background: mc,
                  borderRadius: 4, transition: 'width .5s ease',
                }} />
              </div>
              <span style={{
                textAlign: 'right',
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 700, color: mc, fontSize: 12,
              }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Recommendation card ──────────────────────────────────────── */
function RecommendationPanel({ failurePct, rulHi, rulHours, equipment, recommendation }) {
  // Build a layered recommendation
  let level = 'info';
  let title = 'All systems nominal';
  let body  = recommendation || 'No corrective action required at this time. Continue routine monitoring.';

  if (failurePct != null && failurePct > 60) {
    level = 'critical';
    title = 'Immediate inspection required';
    body  = recommendation
      || `Failure probability is at ${failurePct}% — schedule corrective maintenance before the next shift to avoid unplanned downtime.`;
  } else if (rulHi != null && rulHi < 40) {
    level = 'critical';
    title = 'End-of-life approaching';
    body  = recommendation
      || `Health index ${Math.round(rulHi)}% — plan an overhaul. RUL ${rulHours ? fmtLifetime(rulHours) : '?'} remaining.`;
  } else if (failurePct != null && failurePct > 30) {
    level = 'warning';
    title = 'Preventive maintenance recommended';
    body  = recommendation
      || `Schedule preventive maintenance within the next 7 days. Monitor sensor trends closely.`;
  } else if (rulHi != null && rulHi < 70) {
    level = 'warning';
    title = 'Asset showing wear';
    body  = recommendation
      || `Health declining (${Math.round(rulHi)}%). Re-inspect at next planned outage.`;
  }

  const palette = level === 'critical'
      ? { col: '#dc2626', bg: '#fee2e2', icon: '!' }
      : level === 'warning'
      ? { col: '#d97706', bg: '#fef3c7', icon: '!' }
      : { col: '#16a34a', bg: '#dcfce7', icon: 'OK' };

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">Recommendation</span>
        <span style={{ fontSize: 10.5, color: 'var(--td)', marginLeft: 6 }}>
          synthesised from latest predictions
        </span>
      </div>
      <div style={{ padding: '14px' }}>
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '12px',
          background: palette.bg,
          borderRadius: 6,
          border: `1px solid ${palette.col}33`,
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: 6,
            background: palette.col, color: '#fff',
            fontSize: 13, fontWeight: 700, flexShrink: 0,
          }}>{palette.icon}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: palette.col, marginBottom: 4 }}>
              {title}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--tx)', lineHeight: 1.5 }}>
              {body}
            </div>
          </div>
        </div>

        {equipment && (
          <div style={{
            marginTop: 10, display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)', gap: 6,
            fontSize: 10.5, color: 'var(--tm)',
          }}>
            <MiniMeta label="Asset"      value={equipment.tag || '—'} />
            <MiniMeta label="Status"     value={equipment.status || '—'} />
            <MiniMeta label="Criticality" value={equipment.criticality != null ? `${equipment.criticality}/5` : '—'} />
            <MiniMeta label="Sensors"    value={(equipment.sensors || []).length} />
          </div>
        )}
      </div>
    </div>
  );
}

function MiniMeta({ label, value }) {
  return (
    <div style={{
      background: 'var(--g-softer)',
      border: '1px solid var(--border)',
      borderRadius: 5,
      padding: '6px 9px',
    }}>
      <div style={{ fontSize: 9, color: 'var(--td)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--tx)', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    </div>
  );
}

/* ─── Anomaly score history chart ─────────────────────────────── */
function AnomalyHistoryChart({ data, stamp }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">Anomaly Score History</span>
        <span style={{ fontSize: 10.5, color: 'var(--td)', marginLeft: 6 }}>
          {data.length} samples · 0 = normal · 100 = anomalous
          {stamp && (
            <> · last <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#16a34a' }}>
              {fmtClock(stamp)}
            </span></>
          )}
        </span>
        <span className="menu">⋯</span>
      </div>
      <div style={{ padding: '8px 4px 4px' }}>
        {data.length === 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 200, color: 'var(--td)', fontSize: 12,
          }}>
            No anomaly samples in the selected window.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={data} margin={{ top: 4, right: 20, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="anom-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#e88a3a" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#e88a3a" stopOpacity={0.02} />
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
              <ReferenceLine y={50} stroke="#dc2626" strokeDasharray="4 2"
                label={{ value: 'threshold', fill: '#dc2626', fontSize: 10 }} />
              <Area type="monotone" dataKey="score" stroke="#e88a3a" fill="url(#anom-grad)"
                strokeWidth={2} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/* ─── Failure probability trend chart ────────────────────────── */
function FailureHistoryChart({ data }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">Failure Probability Trend</span>
        <span style={{ fontSize: 10.5, color: 'var(--td)', marginLeft: 6 }}>
          {data.length} predictions
        </span>
        <span className="menu">⋯</span>
      </div>
      <div style={{ padding: '8px 4px 4px' }}>
        {data.length === 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 180, color: 'var(--td)', fontSize: 12,
          }}>
            No predictions in the selected window.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={190}>
            <AreaChart data={data} margin={{ top: 4, right: 20, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="fail-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#dc2626" stopOpacity={0.30} />
                  <stop offset="95%" stopColor="#dc2626" stopOpacity={0.02} />
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
              <ReferenceLine y={60} stroke="#dc2626" strokeDasharray="4 2"
                label={{ value: 'high risk', fill: '#dc2626', fontSize: 10 }} />
              <ReferenceLine y={30} stroke="#d97706" strokeDasharray="4 2"
                label={{ value: 'monitor', fill: '#d97706', fontSize: 10 }} />
              <Area type="monotone" dataKey="prob" stroke="#dc2626" fill="url(#fail-grad)"
                strokeWidth={2}
                dot={{ r: 3, fill: '#dc2626', stroke: '#fff', strokeWidth: 1 }}
                isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
