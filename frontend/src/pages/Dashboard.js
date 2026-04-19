/**
 * Dashboard — OCP PhosWatch real-time overview.
 *
 * Layout (matching the design):
 *   1. Summary strip  — 5 KPI cards (equipment online, alarms, avg health, ML status, active sensors)
 *   2. Row 1          — 4-cell stat grid | bar gauges | equipment health table | sensor chart
 *   3. Row 2          — 3 sensor area charts (each with Grafana legend: max/avg/current)
 *   4. Alarms panel   — full active-alarm table
 *
 * Data: REST API seeds initial state; WebSocket appends live readings.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Equipment, Alarms, Predictions, Sensors } from '../services/api';
import { useLiveFeed } from '../services/websocket';
import AlertsPanel   from '../components/Dashboard/AlertsPanel';
import SensorChart   from '../components/Charts/SensorChart';
import TimeRangePicker, { getRangeParams } from '../components/Charts/TimeRangePicker';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

/* ── colors ───────────────────────────────────────────────────── */
const C = {
  green:  '#007a3d', green2: '#00a352', greenL: '#8fc96f',
  orange: '#e88a3a', red:    '#d64545', yellow: '#d4b13c',
  cyan:   '#2aa3b0', blue:   '#3e72c2', purple: '#8e62c2',
};

/* ── Recharts shared styles ──────────────────────────────────── */
const AXIS_TICK = { fill: '#a8b9b0', fontSize: 9.5, fontFamily: "'JetBrains Mono', monospace" };
const GRID_CLR  = 'rgba(0,122,61,.07)';

const ChartTooltip = ({ active, payload, label, unit = '' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#fff', border: '1px solid #cfdccb', borderRadius: 6,
      padding: '7px 11px', fontSize: 11.5, color: '#102818',
      boxShadow: '0 4px 14px rgba(16,40,24,.10)',
    }}>
      <div style={{ color: '#7e9a8c', marginBottom: 3, fontSize: 10.5 }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.stroke || p.color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
          {typeof p.value === 'number' ? p.value.toFixed(2) : p.value} {unit}
        </div>
      ))}
    </div>
  );
};

/* ── Multi-series chart with Grafana-style legend ─────────────── */
function GrafanaChartPanel({ title, sub, datasets, unit = '', yMin = 0, yMax, height = 160 }) {
  if (!datasets?.length) return null;

  /* Compute legend stats (max / avg / current) from each series */
  const stats = datasets.map(ds => {
    const vals = ds.data.map(d => d.value).filter(v => v != null && !isNaN(v));
    const cur  = vals[vals.length - 1] ?? '--';
    const max  = vals.length ? Math.max(...vals) : '--';
    const avg  = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : '--';
    const fmt  = v => v === '--' ? '--' : typeof v === 'number' ? v.toFixed(2) : v;
    return { label: ds.label, color: ds.color, max: fmt(max), avg: fmt(avg), cur: fmt(cur) };
  });

  /* Merge all datasets onto a common time axis */
  const allTs = [...new Set(datasets.flatMap(ds => ds.data.map(d => d.ts)))].sort();
  const merged = allTs.map(ts => {
    const row = { ts, label: new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) };
    datasets.forEach(ds => {
      const pt = ds.data.find(d => d.ts === ts);
      row[ds.key] = pt ? pt.value : null;
    });
    return row;
  });

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">{title}</span>
        {sub && <span className="sub">{sub}</span>}
        <span className="menu">⋯</span>
      </div>
      <div style={{ padding: '6px 8px 2px', flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={merged} margin={{ top: 4, right: 20, left: -10, bottom: 0 }}>
            <CartesianGrid stroke={GRID_CLR} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} domain={[yMin, yMax || 'auto']} width={42} />
            <Tooltip content={<ChartTooltip unit={unit} />} />
            {datasets.map(ds => (
              <Line key={ds.key} type="monotone" dataKey={ds.key} stroke={ds.color}
                strokeWidth={1.6} dot={false} isAnimationActive={false}
                connectNulls activeDot={{ r: 3.5, stroke: ds.color, fill: '#fff', strokeWidth: 1.5 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* Grafana-style legend table */}
      <div className="legend-tbl">
        <div className="legend-hdr">
          <div></div>
          <div className="max">max</div>
          <div className="avg">avg</div>
          <div className="current">current</div>
        </div>
        {stats.map(s => (
          <div key={s.label} className="legend-row">
            <div className="name">
              <span className="legend-swatch" style={{ background: s.color }} />
              {s.label}
            </div>
            <div className="val">{s.max}</div>
            <div className="val">{s.avg}</div>
            <div className="val current">{s.cur}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Segmented bar gauge ─────────────────────────────────────── */
function BarGauge({ label, value, max = 100 }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = pct > 85 ? C.red : pct > 70 ? C.orange : pct > 50 ? C.yellow : C.green;
  const cls   = pct > 85 ? 'red' : pct > 70 ? 'orange' : pct > 50 ? 'yellow' : 'green';

  const segs = [
    { c: C.green,  w: Math.min(pct, 50)              },
    { c: C.yellow, w: Math.max(0, Math.min(pct, 70)  - 50) },
    { c: C.orange, w: Math.max(0, Math.min(pct, 85)  - 70) },
    { c: C.red,    w: Math.max(0, pct - 85)           },
  ];

  return (
    <div className="bg-row">
      <div className="bg-label">{label}</div>
      <div className="bg-track">
        {segs.map((s, i) => s.w > 0 && (
          <div key={i} className="bg-seg" style={{ width: s.w + '%', background: s.c }} />
        ))}
      </div>
      <div className={`bg-val ${cls}`}>{value.toFixed ? value.toFixed(0) : value}%</div>
    </div>
  );
}

/* ═══════════════ Main Dashboard ═══════════════════════════════ */
export default function Dashboard() {
  const [health,     setHealth]     = useState(null);
  const [alarms,     setAlarms]     = useState([]);
  const [alarmStats, setAlarmStats] = useState(null);
  const [mlStatus,   setMlStatus]   = useState(null);
  const [error,      setError]      = useState('');
  const [range,      setRange]      = useState('all');
  const [chartData,  setChartData]  = useState({});
  const [loading,    setLoading]    = useState(false);
  const liveSeeded = useRef(false);

  const { readings, latestAlarm, connected, seedHistorical } = useLiveFeed({});

  /* ── KPI loader ── */
  const loadKPIs = useCallback(async () => {
    try {
      const [h, a, s, m] = await Promise.all([
        Equipment.health(),
        Alarms.list({ status: 'active', limit: 50 }),
        Alarms.stats(),
        Predictions.mlHealth().catch(() => ({ ok: false })),
      ]);
      setHealth(h);
      setAlarms(a.items || a);
      setAlarmStats(s);
      setMlStatus(m);
      setError('');
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to load dashboard');
    }
  }, []);

  useEffect(() => { loadKPIs(); }, [loadKPIs]);
  useEffect(() => { const t = setInterval(loadKPIs, 30_000); return () => clearInterval(t); }, [loadKPIs]);
  useEffect(() => { if (latestAlarm) loadKPIs(); }, [latestAlarm, loadKPIs]);

  /* ── Featured sensors (up to 4, one per equipment) ── */
  const featured = useMemo(() => {
    const list = [];
    (health?.equipment || []).forEach(eq => {
      (eq.sensors || []).slice(0, 1).forEach(s => list.push({ ...s, equipment: eq }));
    });
    return list.slice(0, 4);
  }, [health]);

  /* ── Chart data loader ── */
  const loadChartData = useCallback(async (sensors, selectedRange) => {
    if (!sensors?.length) return;
    setLoading(true);
    liveSeeded.current = false;
    const { from, bucket } = getRangeParams(selectedRange);
    try {
      const results = await Promise.all(
        sensors.map(s =>
          Sensors.readings(s.id, { from, bucket, limit: 5000 })
            .then(res => ({ id: s.id, points: (res.points || []).map(p => ({ ts: p.ts, value: Number(p.value) })) }))
            .catch(() => ({ id: s.id, points: [] }))
        )
      );
      const newData = {};
      for (const { id, points } of results) newData[id] = points;
      setChartData(newData);
      if (selectedRange === 'live' && !liveSeeded.current) {
        liveSeeded.current = true;
        seedHistorical(newData);
      }
    } finally { setLoading(false); }
  }, [seedHistorical]);

  useEffect(() => { if (featured.length) loadChartData(featured, range); }, [featured, range, loadChartData]);
  useEffect(() => {
    if (range !== 'live' || !featured.length) return;
    const t = setInterval(() => loadChartData(featured, 'live'), 60_000);
    return () => clearInterval(t);
  }, [range, featured, loadChartData]);

  const getSensorData = s => range === 'live' ? (readings[s.id] || []) : (chartData[s.id] || []);

  /* ── Derived KPIs ── */
  const totalEq   = health?.equipment?.length || 0;
  const running   = health?.equipment?.filter(e => e.status === 'running').length || 0;
  const avgHealth = totalEq
    ? (health.equipment.reduce((s, e) => s + (Number(e.health_score) || 0), 0) / totalEq).toFixed(1)
    : '--';
  const totalSensors = (health?.equipment || []).reduce((s, e) => s + (e.sensors?.length || 0), 0);
  const activeAlarms = alarmStats?.active || 0;
  const critAlarms   = (alarmStats?.by_severity?.fatal || 0) + (alarmStats?.by_severity?.critical || 0);
  const warnAlarms   = alarmStats?.by_severity?.warning || 0;

  /* ── Build Grafana-style multi-series datasets from featured sensors ── */
  const seriesColors = [C.orange, C.blue, C.cyan, C.purple];
  const grafanaDatasets = featured.slice(0, 3).map((s, i) => ({
    key:   `s${s.id}`,
    label: `${s.equipment.tag} · ${s.name}`,
    color: seriesColors[i] || C.green,
    data:  getSensorData(s),
  }));

  /* Split into individual charts for Row 2: pairs of sensors */
  const chartGroups = [];
  for (let i = 0; i < featured.length; i += 2) {
    chartGroups.push(featured.slice(i, i + 2));
  }

  /* ── Health table data ── */
  const healthTableData = (health?.equipment || []).slice(0, 6);

  const healthColor = v => {
    if (v >= 80) return { cell: 'green', bar: C.green };
    if (v >= 60) return { cell: 'yellow', bar: C.yellow };
    if (v >= 40) return { cell: 'orange', bar: C.orange };
    return { cell: 'red', bar: C.red };
  };

  /* ── Avg sensor readings for bar gauges ── */
  const avgReadings = featured.map(s => {
    const data = getSensorData(s);
    const last = data[data.length - 1];
    return { label: `${s.equipment.tag}`, value: last ? last.value : 0, unit: s.unit || '' };
  });

  /* ─── Render ─────────────────────────────────────────────────── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Connection status + time range ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`sdot${connected ? '' : ' warn'}`} />
          <span style={{ fontSize: 12, color: 'var(--tm)' }}>
            {connected ? 'WebSocket live' : 'Reconnecting…'}
          </span>
          {loading && <span style={{ fontSize: 11, color: 'var(--td)' }}>Loading charts…</span>}
        </div>
        <TimeRangePicker value={range} onChange={setRange} disabled={loading} />
      </div>

      {error && <div className="error">⚠ {error} — verify Docker containers are running (<code>docker compose up -d</code>)</div>}

      {/* ════════════════════════════════════════════════════════════
          SUMMARY STRIP — 5 KPI cards
      ════════════════════════════════════════════════════════════ */}
      <div className="summary-strip">
        {/* Equipment online */}
        <div className="sum-card">
          <div className="sum-ico g">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <div>
            <div className="sum-lbl">Equipment Online</div>
            <div className="sum-val">{running} <span className="sum-val-unit">/ {totalEq}</span></div>
            <div className={`sum-sub ${running === totalEq && totalEq > 0 ? 'ok' : running > 0 ? 'warn' : 'up'}`}>
              {running === totalEq && totalEq > 0 ? '✓ All running' : `${totalEq - running} offline`}
            </div>
          </div>
        </div>

        {/* Active alarms */}
        <div className="sum-card">
          <div className={`sum-ico ${critAlarms > 0 ? 'r' : activeAlarms > 0 ? 'o' : 'g'}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
          </div>
          <div>
            <div className="sum-lbl">Active Alarms</div>
            <div className="sum-val">{activeAlarms}</div>
            <div className={`sum-sub ${critAlarms > 0 ? 'up' : activeAlarms > 0 ? 'warn' : 'ok'}`}>
              {activeAlarms === 0 ? '✓ All clear' : `${critAlarms} critical · ${warnAlarms} warning`}
            </div>
          </div>
        </div>

        {/* Avg health */}
        <div className="sum-card">
          <div className={`sum-ico ${avgHealth >= 70 ? 'g' : avgHealth >= 40 ? 'o' : 'r'}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <div>
            <div className="sum-lbl">Avg Health Score</div>
            <div className="sum-val">{avgHealth}<span className="sum-val-unit">%</span></div>
            <div className={`sum-sub ${avgHealth >= 70 ? 'ok' : avgHealth >= 40 ? 'warn' : 'up'}`}>
              {avgHealth >= 70 ? '✓ Good condition' : avgHealth >= 40 ? '⚠ Monitor closely' : '✗ Action needed'}
            </div>
          </div>
        </div>

        {/* ML service */}
        <div className="sum-card">
          <div className={`sum-ico ${mlStatus?.ok ? 'b' : 'r'}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
          </div>
          <div>
            <div className="sum-lbl">ML Service</div>
            <div className="sum-val" style={{ fontSize: 16 }}>{mlStatus?.ok ? 'Online' : 'Offline'}</div>
            <div className={`sum-sub ${mlStatus?.ok ? 'ok' : 'up'}`}>
              {mlStatus?.ok
                ? `${mlStatus.models_loaded || 0} models loaded`
                : 'Service unavailable'}
            </div>
          </div>
        </div>

        {/* Active sensors */}
        <div className="sum-card">
          <div className="sum-ico c">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </div>
          <div>
            <div className="sum-lbl">Active Sensors</div>
            <div className="sum-val">{totalSensors}</div>
            <div className="sum-sub ok">
              {featured.length} featured · {range === 'live' ? 'live feed' : range}
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════
          ROW 1 — Stat grid | Bar gauges | Health table | Sensor chart
      ════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 300px 1fr 1fr', gap: 12, minHeight: 220 }}>

        {/* 2×2 stat grid */}
        <div className="panel">
          <div className="panel-body" style={{ padding: 0, flex: 1 }}>
            <div className="stat-pair">
              <div className="stat-cell">
                <div className="stat-title">Equipment Units</div>
                <div className={`stat-big ${running === totalEq ? 'green' : 'orange'}`}>
                  {totalEq}
                </div>
              </div>
              <div className="stat-cell" style={{ borderLeft: '1px solid var(--border)' }}>
                <div className="stat-title">Total Sensors</div>
                <div className="stat-big cyan">{totalSensors}</div>
              </div>
              <div className="stat-cell" style={{ borderTop: '1px solid var(--border)' }}>
                <div className="stat-title">Running</div>
                <div className="stat-big green">{running}<span className="u">/ {totalEq}</span></div>
              </div>
              <div className="stat-cell" style={{ borderTop: '1px solid var(--border)', borderLeft: '1px solid var(--border)' }}>
                <div className="stat-title">Health Score</div>
                <div className={`stat-big ${avgHealth >= 70 ? 'green' : avgHealth >= 40 ? 'yellow' : 'red'}`}>
                  {avgHealth}<span className="u">%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bar gauges — sensor readings */}
        <div className="panel">
          <div className="panel-head">
            <span className="title">Live Sensor Readings</span>
            <span className="menu">⋯</span>
          </div>
          <div className="panel-body bar-gauge-panel">
            {avgReadings.length > 0 ? avgReadings.map((r, i) => (
              <BarGauge key={i} label={r.label} value={Math.min(100, Math.abs(r.value))} max={100} />
            )) : (
              Array.from({ length: 5 }).map((_, i) => (
                <BarGauge key={i} label="—" value={0} />
              ))
            )}
          </div>
        </div>

        {/* Equipment health table */}
        <div className="panel">
          <div className="panel-head">
            <span className="title">Equipment Health Status</span>
            <span className="menu">⋯</span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Health</th>
                  <th style={{ textAlign: 'right' }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {healthTableData.map(eq => {
                  const h = Number(eq.health_score) || 0;
                  const { cell } = healthColor(h);
                  return (
                    <tr key={eq.id}>
                      <td><code style={{ fontSize: 11 }}>{eq.tag}</code></td>
                      <td>
                        <span className={`badge ${
                          eq.status === 'running' ? 'ok' :
                          eq.status === 'fault' ? 'bad' :
                          eq.status === 'maintenance' ? 'warn' : 'idle'
                        }`}>{eq.status}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <div style={{ width: 60, height: 6, background: 'var(--g-softer)', borderRadius: 3, overflow: 'hidden', border: '1px solid var(--border)' }}>
                            <div style={{ width: `${h}%`, height: '100%', background: healthColor(h).bar, borderRadius: 2, transition: 'width .4s' }} />
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={`pct-cell ${cell}`}>{h.toFixed(0)}%</span>
                      </td>
                    </tr>
                  );
                })}
                {!healthTableData.length && (
                  <tr><td colSpan="4" style={{ textAlign: 'center', padding: 20, color: 'var(--td)' }}>
                    Loading equipment…
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* First featured sensor chart */}
        {featured[0] ? (
          <SensorChart
            sensorId={featured[0].id}
            measurement={featured[0].measurement}
            title={`${featured[0].equipment.tag} · ${featured[0].name}`}
            unit={featured[0].unit || ''}
            data={getSensorData(featured[0])}
            thresholds={{ h1: featured[0].h1, h2: featured[0].h2, l1: featured[0].l1, l2: featured[0].l2 }}
            height={160}
            live={range === 'live' && connected}
          />
        ) : (
          <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--td)', fontSize: 13 }}>
            No sensor data
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════
          ROW 2 — Multi-series Grafana charts
      ════════════════════════════════════════════════════════════ */}
      {featured.length > 0 && (
        <div>
          <div style={{
            fontSize: 10.5, fontWeight: 700, color: 'var(--tm)',
            letterSpacing: '.6px', textTransform: 'uppercase',
            marginBottom: 10,
            borderLeft: '3px solid var(--g)', paddingLeft: 10,
          }}>
            Sensor Trends — {featured.length} sensors · {
              range === 'all' ? 'Full history' :
              range === 'live' ? 'Live feed' : `Last ${range}`
            }
          </div>
          <div className="grid-3">
            {chartGroups.map((group, gi) => (
              <GrafanaChartPanel
                key={gi}
                title={group.length === 1 ? `${group[0].equipment.tag} · ${group[0].name}` : `Sensor Group ${gi + 1}`}
                sub={group.map(s => s.unit).filter(Boolean).join(' / ') || undefined}
                unit={group[0]?.unit || ''}
                height={150}
                datasets={group.map((s, si) => ({
                  key:   `s${s.id}`,
                  label: `${s.equipment.tag} · ${s.name}`,
                  color: seriesColors[gi * 2 + si] || C.green,
                  data:  getSensorData(s),
                }))}
              />
            ))}

            {/* If <3 chart groups, fill with a 2nd sensor chart */}
            {featured[1] && chartGroups.length < 3 && (
              <SensorChart
                sensorId={featured[1].id}
                measurement={featured[1].measurement}
                title={`${featured[1].equipment.tag} · ${featured[1].name}`}
                unit={featured[1].unit || ''}
                data={getSensorData(featured[1])}
                thresholds={{ h1: featured[1].h1, h2: featured[1].h2, l1: featured[1].l1, l2: featured[1].l2 }}
                height={150}
                live={range === 'live' && connected}
              />
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          ROW 3 — Additional sensor charts (3rd and 4th sensor)
      ════════════════════════════════════════════════════════════ */}
      {featured.length >= 3 && (
        <div className="grid-2">
          {featured.slice(2, 4).map(s => (
            <SensorChart
              key={s.id}
              sensorId={s.id}
              measurement={s.measurement}
              title={`${s.equipment.tag} · ${s.name}`}
              unit={s.unit || ''}
              data={getSensorData(s)}
              thresholds={{ h1: s.h1, h2: s.h2, l1: s.l1, l2: s.l2 }}
              height={180}
              live={range === 'live' && connected}
            />
          ))}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          Alarms panel
      ════════════════════════════════════════════════════════════ */}
      <AlertsPanel alarms={alarms} onRefresh={loadKPIs} />
    </div>
  );
}
