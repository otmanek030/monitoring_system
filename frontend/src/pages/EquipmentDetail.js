/**
 * EquipmentDetail — live page for a single piece of equipment.
 *
 * Features
 * ────────
 * • Time range picker (Live 5m / 1h / 6h / 24h / 7d / All)
 *   – "All" is the default so the user immediately sees the full history.
 * • Per-measurement chart types via SensorChart (temperature, vibration,
 *   pressure, flow, current, speed, level, pH, density, position, tension…)
 * • Sensors are grouped by measurement category so related signals are
 *   presented together.
 * • For "Live" range: WebSocket ring buffer is seeded with REST data,
 *   new readings then append in real time.
 * • For historical ranges: data comes from REST API with appropriate
 *   bucket aggregation (raw → 1m → 5m → 1h as window grows).
 * • Min-max bands are drawn when buckets are used.
 * • AI prediction panel (anomaly + RUL) and recent alarms at the bottom.
 * • Excel / PDF export buttons.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Equipment as EqApi, Predictions, Alarms, Sensors, Reports } from '../services/api';
import { useLiveFeed } from '../services/websocket';
import SensorChart    from '../components/Charts/SensorChart';
import TimeRangePicker, { getRangeParams } from '../components/Charts/TimeRangePicker';
import AnomalyDisplay from '../components/ML/AnomalyDisplay';
import RULIndicator   from '../components/ML/RULIndicator';
import ExportButton   from '../components/Reports/ExportButton';
import { useAuth }    from '../contexts/AuthContext';

// ─── Group sensors by measurement category ────────────────────────────────────
const MEASUREMENT_ORDER = [
  'vibration', 'temperature', 'pressure', 'flow',
  'current', 'speed', 'level', 'ph', 'density', 'tension', 'position',
];

function groupSensors(sensors = []) {
  const groups = {};
  for (const s of sensors) {
    const key = s.measurement || 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  }
  // Sort groups by measurement order, unknown types go at the end
  return Object.entries(groups).sort(([a], [b]) => {
    const ai = MEASUREMENT_ORDER.indexOf(a);
    const bi = MEASUREMENT_ORDER.indexOf(b);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
}

const MEASUREMENT_LABELS = {
  vibration: '📳 Vibration',
  temperature: '🌡 Temperature',
  pressure: '🔵 Pressure',
  flow: '💧 Flow',
  current: '⚡ Current',
  speed: '🌀 Speed / RPM',
  level: '📊 Level',
  ph: '🧪 pH',
  density: '⚖ Density',
  tension: '🔗 Tension',
  position: '📐 Position',
  other: '📈 Other',
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function EquipmentDetail() {
  const { id }   = useParams();
  const eqId     = Number(id);
  const { can }  = useAuth();

  // ── State ──────────────────────────────────────────────────────────────────
  const [equipment, setEquipment] = useState(null);
  const [alarms,    setAlarms]    = useState([]);
  const [anomaly,   setAnomaly]   = useState(null);
  const [rul,       setRul]       = useState(null);
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState('');
  const [range,     setRange]     = useState('all');       // default: whole history
  const [chartData, setChartData] = useState({});          // { sensor_id: [{ts,value,min?,max?}] }
  const [loading,   setLoading]   = useState(false);

  // WebSocket — used only in "live" mode
  const { readings, connected, seedHistorical } = useLiveFeed({ equipmentId: eqId });
  const liveSeeded = useRef(false);

  // ── Load equipment metadata once ──────────────────────────────────────────
  useEffect(() => {
    let active = true;
    Promise.all([
      EqApi.get(eqId),
      Alarms.list({ equipment_id: eqId, limit: 30 }),
      Predictions.rul(eqId).catch(() => null),
    ]).then(([eq, al, r]) => {
      if (!active) return;
      setEquipment(eq);
      setAlarms(al.items || al);
      setRul(r);
    }).catch(e => setError(e.response?.data?.message || 'Failed to load equipment'));
    return () => { active = false; };
  }, [eqId]);

  // ── Load chart data whenever range or equipment changes ───────────────────
  const loadChartData = useCallback(async (sensors, selectedRange) => {
    if (!sensors?.length) return;
    setLoading(true);
    liveSeeded.current = false;     // reset live-seed guard on range change

    const { from, bucket } = getRangeParams(selectedRange);

    try {
      const results = await Promise.all(
        sensors.map(s =>
          Sensors.readings(s.id, { from, bucket, limit: 5000 })
            .then(res => ({
              id: s.id,
              // Normalise: raw → {ts, value}, aggregated → {ts, value, min, max}
              points: (res.points || []).map(p => ({
                ts:    p.ts,
                value: Number(p.value),
                ...(p.min != null ? { min: Number(p.min), max: Number(p.max) } : {}),
              })),
            }))
            .catch(() => ({ id: s.id, points: [] }))
        )
      );

      const newData = {};
      for (const { id: sid, points } of results) {
        newData[sid] = points;
      }
      setChartData(newData);

      // For live mode: seed the WS buffer with the fetched REST data so the
      // ring buffer starts with real history instead of being empty.
      if (selectedRange === 'live' && !liveSeeded.current) {
        liveSeeded.current = true;
        seedHistorical(newData);
      }
    } finally {
      setLoading(false);
    }
  }, [seedHistorical]);

  useEffect(() => {
    if (equipment?.sensors) {
      loadChartData(equipment.sensors, range);
    }
  }, [equipment, range, loadChartData]);

  // For "live", auto-refresh the seed every 60 s so long-running sessions
  // keep the historical baseline fresh.
  useEffect(() => {
    if (range !== 'live' || !equipment?.sensors) return;
    const t = setInterval(() => loadChartData(equipment.sensors, 'live'), 60_000);
    return () => clearInterval(t);
  }, [range, equipment, loadChartData]);

  // ── Decide what data to show per sensor ───────────────────────────────────
  // Live: WebSocket ring buffer (continuously updated)
  // Historical: REST API response
  const getSensorData = (sensor) =>
    range === 'live'
      ? (readings[sensor.id] || [])
      : (chartData[sensor.id] || []);

  // ── AI predictions ────────────────────────────────────────────────────────
  const runPredictions = async () => {
    if (!equipment?.sensors?.length) return;
    setBusy(true);
    try {
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

  // ── Render guards ─────────────────────────────────────────────────────────
  if (!equipment) {
    return (
      <div style={{ padding: 24, color: '#7b8799' }}>
        {error ? `⚠ ${error}` : 'Loading equipment…'}
      </div>
    );
  }

  const sensorGroups = groupSensors(equipment.sensors || []);
  const from24 = new Date(Date.now() - 86_400_000).toISOString().slice(0, 19);
  const toNow  = new Date().toISOString().slice(0, 19);

  return (
    <div>
      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                    flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: '#7b8799', marginBottom: 4 }}>
            <Link to="/equipment" style={{ color: '#7b8799' }}>← Equipment</Link>
          </div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <code style={{ background: '#182343', padding: '2px 8px', borderRadius: 4,
                           fontSize: 14, color: '#4da3ff' }}>{equipment.tag}</code>
            <span style={{ fontSize: 18 }}>{equipment.name}</span>
            <span className={`badge ${connected ? 'ok' : 'warn'}`} style={{ fontSize: 11 }}>
              {connected ? '⬤ live' : '○ reconnecting'}
            </span>
          </h2>
        </div>

        {/* Time range picker */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <TimeRangePicker value={range} onChange={setRange} disabled={loading} />
          {loading && (
            <span style={{ fontSize: 11, color: '#7b8799' }}>Loading data…</span>
          )}
        </div>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>⚠ {error}</div>}

      {/* ── Info cards ── */}
      <div className="grid-3" style={{ marginBottom: 16 }}>
        <InfoBox label="Status"       value={equipment.status}                           />
        <InfoBox label="Area"         value={`${equipment.area_code} · ${equipment.area_name || ''}`} />
        <InfoBox label="Health index" value={`${equipment.health_score ?? 100} %`}       />
        <InfoBox label="Type"         value={equipment.type_name || '--'}                />
        <InfoBox label="Runtime"      value={`${Number(equipment.runtime_hours || 0).toLocaleString()} h`} />
        <InfoBox label="Expected life" value={`${Number(equipment.expected_life_hours || 0).toLocaleString()} h`} />
      </div>

      {/* ── Sensor charts grouped by measurement ── */}
      {sensorGroups.length === 0 && (
        <div className="card" style={{ padding: 24, color: '#7b8799', textAlign: 'center' }}>
          No sensors configured for this equipment.
        </div>
      )}

      {sensorGroups.map(([measurement, sensors]) => (
        <div key={measurement} style={{ marginBottom: 20 }}>
          {/* Group header */}
          <div style={{ fontSize: 12, fontWeight: 700, color: '#7b8799', letterSpacing: '.8px',
                        textTransform: 'uppercase', marginBottom: 8, padding: '0 2px',
                        borderLeft: '3px solid #4da3ff', paddingLeft: 10 }}>
            {MEASUREMENT_LABELS[measurement] || measurement}
          </div>

          {/* 2-column grid of charts */}
          <div className="grid-2">
            {sensors.map(s => (
              <SensorChart
                key={s.id}
                sensorId={s.id}
                measurement={s.measurement}
                title={`${s.tag} · ${s.name}`}
                unit={s.unit || ''}
                data={getSensorData(s)}
                thresholds={{ h1: s.h1, h2: s.h2, l1: s.l1, l2: s.l2 }}
                height={200}
                live={range === 'live' && connected}
              />
            ))}
          </div>
        </div>
      ))}

      {/* ── AI predictions ── */}
      <div className="grid-2" style={{ marginTop: 16 }}>
        <AnomalyDisplay result={anomaly} />
        <RULIndicator   rul={rul} />
      </div>

      {/* ── Action buttons ── */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {can('predictions', 'r') && (
          <button className="primary" onClick={runPredictions} disabled={busy}>
            {busy ? 'Running…' : '🤖 Run AI predictions'}
          </button>
        )}
        <button className="ghost" onClick={() => loadChartData(equipment.sensors, range)} disabled={loading}>
          ↺ Refresh charts
        </button>
        {can('reports', 'r') && (
          <>
            <ExportButton
              url={Reports.equipmentXlsxUrl(eqId, from24, toNow)}
              filename={`${equipment.tag}_24h.xlsx`}
              label="Excel (24h)"
            />
            <ExportButton
              url={Reports.equipmentPdfUrl(eqId, from24, toNow)}
              filename={`${equipment.tag}_24h.pdf`}
              label="PDF (24h)"
            />
          </>
        )}
      </div>

      {/* ── Recent alarms ── */}
      <div style={{ marginTop: 20 }}>
        <div className="card">
          <div className="card-head">
            <strong>Recent alarms</strong>
            <span className="muted" style={{ fontSize: 12 }}>{alarms.length} records</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Sensor</th>
                  <th>Message</th>
                  <th>Opened</th>
                  <th>Closed</th>
                </tr>
              </thead>
              <tbody>
                {alarms.length ? alarms.map(a => (
                  <tr key={a.id || a.alarm_id}>
                    <td>
                      <span className={`badge ${a.severity === 'fatal' ? 'fatal' : a.severity === 'warning' ? 'warn' : 'info'}`}>
                        {a.severity}
                      </span>
                    </td>
                    <td><code style={{ fontSize: 11 }}>{a.sensor_tag || '--'}</code></td>
                    <td style={{ maxWidth: 280 }}>{a.message}</td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {new Date(a.opened_at || a.ts).toLocaleString()}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {a.closed_at || a.cleared_ts
                        ? new Date(a.closed_at || a.cleared_ts).toLocaleString()
                        : <span style={{ color: '#ef4757' }}>Open</span>}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 20, color: '#4a5568' }}>
                      No alarms recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Info box ─────────────────────────────────────────────────────────────────
function InfoBox({ label, value }) {
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div className="kpi-label" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ color: '#e8eefc', fontSize: 16, fontWeight: 600 }}>{value || '--'}</div>
    </div>
  );
}
