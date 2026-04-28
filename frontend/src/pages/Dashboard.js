/**
 * Dashboard — OCP PhosWatch real-time overview.
 *
 * Layout (reference design):
 *   TOP STRIP   — 5 KPI cards
 *   ROW 1       — Equipment Health table | Live Sensor Readings bar-gauges | 2 sensor trend charts
 *   ROW 2       — 3 Grafana-style multi-series trend panels (sensor_00..02, sensor_03..05, sensor_06..08)
 *   ROW 3       — Health Distribution pie + Predictive Analytics summary
 *   BOTTOM      — Active Alarms panel
 *
 * Sensor data: uses the CSV dataset (sensor_00..sensor_08 mapped to real equipment sensors).
 * WebSocket live feed appends new readings on top of seeded history.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Equipment, Alarms, Predictions } from '../services/api';
import { useLiveFeed } from '../services/websocket';
import TimeRangePicker from '../components/Charts/TimeRangePicker';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, PieChart, Pie, Cell,
} from 'recharts';

/* ─── OCP color palette ────────────────────────────────────────── */
const C = {
  green:  '#007a3d', green2: '#00a352', greenL: '#8fc96f',
  orange: '#e88a3a', red:    '#d64545', yellow: '#d4b13c',
  cyan:   '#2aa3b0', blue:   '#3e72c2', purple: '#8e62c2',
};

const AXIS_TICK = { fill: '#a8b9b0', fontSize: 9.5, fontFamily: "'JetBrains Mono', monospace" };
const GRID_CLR  = 'rgba(0,122,61,.07)';

/* ─── CSV sensor metadata (mapped from real dataset columns) ───── */
const CSV_SENSORS = [
  { key: 'sensor_00', label: 'Vib. Pump A',    unit: 'mm/s', lo: 1.8,  hi: 3.2,  color: C.orange },
  { key: 'sensor_01', label: 'Press. Line 1',  unit: 'bar',  lo: 40,   hi: 55,   color: C.blue   },
  { key: 'sensor_02', label: 'Temp. Bearing',  unit: '°C',   lo: 50,   hi: 58,   color: C.red    },
  { key: 'sensor_03', label: 'Flow Rate',      unit: 'L/min',lo: 42,   hi: 50,   color: C.cyan   },
  { key: 'sensor_04', label: 'Motor Load',     unit: '%',    lo: 580,  hi: 680,  color: C.purple },
  { key: 'sensor_05', label: 'Shaft Speed',    unit: 'rpm',  lo: 70,   hi: 82,   color: C.green2 },
  { key: 'sensor_06', label: 'Current Draw',   unit: 'A',    lo: 12,   hi: 14.5, color: C.orange },
  { key: 'sensor_07', label: 'Inlet Temp.',    unit: '°C',   lo: 14,   hi: 17.5, color: C.blue   },
  { key: 'sensor_08', label: 'Outlet Temp.',   unit: '°C',   lo: 14,   hi: 17,   color: C.red    },
];

/* ─── Parse CSV text → array of row objects ─────────────────────── */
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h.trim()] = vals[i]?.trim() ?? ''; });
    return row;
  });
}

/* ─── Convert CSV rows → chart-ready { ts, value } array ─────── */
function csvRowsToSeries(rows, key) {
  return rows
    .filter(r => r[key] && r[key] !== '')
    .map(r => ({
      ts:    new Date(r.timestamp).getTime(),
      value: parseFloat(r[key]),
      label: r.timestamp?.slice(11, 16) || '',
      status: r.machine_status || 'NORMAL',
    }))
    .filter(r => !isNaN(r.value));
}

/* ─── Tooltip ───────────────────────────────────────────────────── */
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
        <div key={p.dataKey} style={{
          color: p.stroke || p.color,
          fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
        }}>
          {typeof p.value === 'number' ? p.value.toFixed(3) : p.value} {unit}
        </div>
      ))}
    </div>
  );
};

/* ─── Grafana-style multi-series chart panel ────────────────────── */
function GrafanaPanel({ title, sub, datasets = [], unit = '', height = 155 }) {
  if (!datasets.length) return null;

  const stats = datasets.map(ds => {
    const vals = ds.data.map(d => d.value).filter(v => v != null && !isNaN(v));
    const cur  = vals[vals.length - 1] ?? '--';
    const max  = vals.length ? Math.max(...vals) : '--';
    const avg  = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : '--';
    const fmt  = v => v === '--' ? '--' : v.toFixed(3);
    return { label: ds.label, color: ds.color, max: fmt(max), avg: fmt(avg), cur: fmt(cur) };
  });

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
    <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-head">
        <span className="title">{title}</span>
        {sub && <span className="sub" style={{ fontSize: 10.5, color: 'var(--td)', marginLeft: 4 }}>{sub}</span>}
        <span className="menu">⋯</span>
      </div>
      <div style={{ padding: '6px 8px 2px', flex: 1 }}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={merged} margin={{ top: 4, right: 16, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={GRID_CLR} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={50} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} domain={['auto', 'auto']} width={44} />
            <Tooltip content={<ChartTooltip unit={unit} />} />
            {datasets.map(ds => (
              <Line key={ds.key} type="monotone" dataKey={ds.key} stroke={ds.color}
                strokeWidth={1.6} dot={false} isAnimationActive={false}
                connectNulls activeDot={{ r: 3.5, stroke: ds.color, fill: '#fff', strokeWidth: 1.5 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* Grafana legend table */}
      <div style={{
        borderTop: '1px solid var(--border)',
        padding: '6px 10px',
        fontSize: 10.5,
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px 56px 64px', gap: 2, color: 'var(--td)', marginBottom: 4 }}>
          <div></div><div style={{ textAlign: 'right' }}>max</div>
          <div style={{ textAlign: 'right' }}>avg</div>
          <div style={{ textAlign: 'right', color: 'var(--tm)', fontWeight: 600 }}>current</div>
        </div>
        {stats.map(s => (
          <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '1fr 56px 56px 64px', gap: 2, marginBottom: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
              <span style={{ width: 8, height: 8, minWidth: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
              <span style={{ color: 'var(--tm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            </div>
            <div style={{ textAlign: 'right', color: 'var(--td)' }}>{s.max}</div>
            <div style={{ textAlign: 'right', color: 'var(--td)' }}>{s.avg}</div>
            <div style={{ textAlign: 'right', color: s.color, fontWeight: 700 }}>{s.cur}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Segmented bar gauge ───────────────────────────────────────── */
function BarGauge({ label, pct = 0, value, unit = '' }) {
  const clampedPct = Math.max(0, Math.min(100, pct));
  const color = clampedPct > 85 ? C.red : clampedPct > 70 ? C.orange : clampedPct > 50 ? C.yellow : C.green;
  const cls   = clampedPct > 85 ? 'red' : clampedPct > 70 ? 'orange' : clampedPct > 50 ? 'yellow' : 'green';
  return (
    <div className="bg-row">
      <div className="bg-label" style={{ minWidth: 90, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </div>
      <div className="bg-track" style={{ flex: 1, height: 8, background: 'var(--g-softer)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{ width: `${clampedPct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .4s' }} />
      </div>
      <div className={`bg-val ${cls}`} style={{ minWidth: 62, textAlign: 'right', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
        {typeof value === 'number' ? value.toFixed(2) : '--'} <span style={{ fontSize: 9.5, color: 'var(--td)', fontWeight: 400 }}>{unit}</span>
      </div>
    </div>
  );
}

/* ─── Health distribution pie ───────────────────────────────────── */
const PIE_COLORS = [C.green, C.yellow, C.red];
function HealthDistPanel({ equipment = [] }) {
  if (!equipment.length) return null;
  const buckets = [
    { label: 'Good (70–100%)',   min: 70, max: 101 },
    { label: 'At Risk (40–69%)', min: 40, max: 70  },
    { label: 'Critical (<40%)',  min: -1, max: 40  },
  ];
  const pieData = buckets
    .map(b => ({
      name:  b.label,
      value: equipment.filter(e => { const h = Number(e.health_score) || 0; return h >= b.min && h < b.max; }).length,
    }))
    .filter(d => d.value > 0);

  const worst = [...equipment].sort((a, b) => (Number(a.health_score) || 0) - (Number(b.health_score) || 0)).slice(0, 5);

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">Health Distribution</span>
        <span style={{ fontSize: 10.5, color: 'var(--tm)', marginLeft: 4 }}>{equipment.length} assets</span>
        <span className="menu">⋯</span>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '4px 8px 8px', flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 auto' }}>
          <ResponsiveContainer width={150} height={150}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={38} outerRadius={60}
                dataKey="value" isAnimationActive={false}
                label={({ percent }) => `${Math.round(percent * 100)}%`} labelLine={false}>
                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % 3]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#fff', border: '1px solid #ddd', borderRadius: 5, fontSize: 11 }}
                formatter={(v, n) => [v + ' assets', n]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ flex: 1, minWidth: 110, paddingTop: 8 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>
            Attention Required
          </div>
          {worst.map(eq => {
            const h = Number(eq.health_score) || 0;
            const col = h >= 70 ? C.green : h >= 40 ? C.yellow : C.red;
            return (
              <div key={eq.id} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <div style={{ width: 56, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${h}%`, height: '100%', background: col, borderRadius: 3 }} />
                </div>
                <code style={{ fontSize: 10.5, color: 'var(--tm)', minWidth: 70 }}>{eq.tag}</code>
                <span style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace", color: col, fontWeight: 700 }}>
                  {h.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN DASHBOARD
═══════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  /* ── API state ── */
  const [health,     setHealth]     = useState(null);
  const [alarms,     setAlarms]     = useState([]);
  const [alarmStats, setAlarmStats] = useState(null);
  const [mlStatus,   setMlStatus]   = useState(null);
  const [error,      setError]      = useState('');
  const [range,      setRange]      = useState('1h');
  const [loading,    setLoading]    = useState(false);

  /* ── CSV sensor data (loaded once at mount) ── */
  const [csvSeries, setCsvSeries] = useState({}); // { sensor_key: [{ts,value,label}] }
  const [csvStatus, setCsvStatus] = useState({}); // { sensor_key: latest machine_status }

  /* ── Live feed — WebSocket streams new sensor readings ── */
  const { readings: liveReadings, latestAlarm, connected, seedHistorical } = useLiveFeed({ bufferSize: 400 });
  const seededRef = useRef(false);

  /* ── Load CSV data for realistic sensor charts ── */
  useEffect(() => {
    fetch('/sensor.csv')
      .then(r => r.ok ? r.text() : Promise.reject('CSV not found'))
      .then(text => {
        const rows = parseCSV(text);
        // Use last 400 rows for performance
        const subset = rows.slice(-400);
        const series = {};
        const statuses = {};
        CSV_SENSORS.forEach(s => {
          series[s.key] = csvRowsToSeries(subset, s.key);
          const lastRow = subset[subset.length - 1];
          statuses[s.key] = lastRow?.machine_status || 'NORMAL';
        });
        setCsvSeries(series);
        setCsvStatus(statuses);
        // Seed the WebSocket ring buffer with CSV history so live points append smoothly
        if (!seededRef.current) {
          seededRef.current = true;
          // Map sensor keys to numeric IDs that the backend emits (sensor_00 → 0, etc.)
          const seedData = {};
          CSV_SENSORS.forEach((s, idx) => {
            seedData[idx] = series[s.key].map(pt => ({ ts: pt.ts, value: pt.value }));
          });
          seedHistorical(seedData);
        }
      })
      .catch(() => {
        // CSV not served — generate synthetic fallback data starting from 15 Apr 2026
        const startMs = new Date('2026-04-15T00:00:00Z').getTime();
        const now = Date.now();
        const intervalMs = Math.floor((now - startMs) / 120);
        const series = {};
        CSV_SENSORS.forEach(s => {
          const base = (s.lo + s.hi) / 2;
          const rng  = (s.hi - s.lo) * 0.3;
          series[s.key] = Array.from({ length: 120 }, (_, i) => {
            const t = startMs + i * intervalMs;
            return {
              ts:    t,
              value: base + (Math.random() - 0.5) * rng,
              label: new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
              status: 'NORMAL',
            };
          });
        });
        setCsvSeries(series);
      });
  }, [seedHistorical]);

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

  /* ── Derived KPIs ── */
  const totalEq      = health?.equipment?.length || 0;
  const running      = health?.equipment?.filter(e => e.status === 'running').length || 0;
  const avgHealth    = totalEq
    ? (health.equipment.reduce((s, e) => s + (Number(e.health_score) || 0), 0) / totalEq).toFixed(1)
    : '--';
  const totalSensors = (health?.equipment || []).reduce((s, e) => s + (e.sensors?.length || 0), 0);
  const activeAlarms = alarmStats?.active || 0;
  const critAlarms   = (alarmStats?.by_severity?.fatal || 0) + (alarmStats?.by_severity?.critical || 0);
  const warnAlarms   = alarmStats?.by_severity?.warning || 0;
  const healthTableData = (health?.equipment || []).slice(0, 8);

  const healthColor = v => {
    if (v >= 80) return { cls: 'green', bar: C.green };
    if (v >= 60) return { cls: 'yellow', bar: C.yellow };
    if (v >= 40) return { cls: 'orange', bar: C.orange };
    return { cls: 'red', bar: C.red };
  };

  /* ── Bar gauges: use merged (live-updated) series ── */
  const gaugeReadings = CSV_SENSORS.slice(0, 6).map(s => {
    const data  = mergedSeries[s.key] || [];
    const last  = data[data.length - 1];
    const val   = last?.value ?? null;
    const range = s.hi - s.lo;
    const pct   = val != null ? Math.max(0, Math.min(100, ((val - s.lo) / range) * 100)) : 0;
    return { label: s.label, value: val, pct, unit: s.unit };
  });

  /* ── Merge CSV history + live WebSocket points for each sensor ── */
  // liveReadings keys are numeric IDs (0,1,2...) from WebSocket events.
  // We blend them on top of csvSeries so charts stay live after CSV is loaded.
  const mergedSeries = {};
  CSV_SENSORS.forEach((s, idx) => {
    const base = csvSeries[s.key] || [];
    const live = (liveReadings[idx] || []).map(pt => ({
      ts:    pt.ts,
      value: pt.value,
      label: new Date(pt.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      status: 'NORMAL',
    }));
    // Deduplicate: keep only live points newer than last CSV point
    const lastCsvTs = base.length ? base[base.length - 1].ts : 0;
    const freshLive = live.filter(pt => pt.ts > lastCsvTs);
    const combined  = [...base, ...freshLive].slice(-400);
    mergedSeries[s.key] = combined;
  });

  /* ── Build Grafana panels: 3 groups of 3 sensors ── */
  const panelGroups = [
    { title: 'Vibration & Pressure', sub: 'sensor_00..02', sensors: CSV_SENSORS.slice(0, 3) },
    { title: 'Flow, Load & Speed',   sub: 'sensor_03..05', sensors: CSV_SENSORS.slice(3, 6) },
    { title: 'Current & Temperature',sub: 'sensor_06..08', sensors: CSV_SENSORS.slice(6, 9) },
  ];

  /* ── CSV data summary for predictive panel ── */
  const brokenCount    = Object.values(csvStatus).filter(s => s === 'BROKEN').length;
  const recoveringCount = Object.values(csvStatus).filter(s => s === 'RECOVERING').length;

  /* ─── Render ──────────────────────────────────────────────────── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Connection status + time range */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`sdot${connected ? '' : ' warn'}`} />
          <span style={{ fontSize: 12, color: 'var(--tm)' }}>
            {connected ? 'WebSocket live' : 'Reconnecting…'}
          </span>
          {loading && <span style={{ fontSize: 11, color: 'var(--td)' }}>Loading…</span>}
          {Object.keys(mergedSeries).length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--td)', background: 'var(--g-softer)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 4 }}>
              {connected ? '🟢 Live' : '⚪ Historical'} · {Object.values(mergedSeries).reduce((s, d) => s + d.length, 0).toLocaleString()} pts
            </span>
          )}
        </div>
        <TimeRangePicker value={range} onChange={setRange} disabled={loading} />
      </div>

      {error && (
        <div className="error">
          ⚠ {error} — verify Docker containers are running (<code>docker compose up -d</code>)
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TOP STRIP — 5 KPI cards
      ══════════════════════════════════════════════════════════ */}
      <div className="summary-strip">

        {/* Equipment Online */}
        <div className="sum-card">
          <div className={`sum-ico ${running === totalEq && totalEq > 0 ? 'g' : running > 0 ? 'o' : 'r'}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <div>
            <div className="sum-lbl">Equipment Online</div>
            <div className="sum-val">{running}<span className="sum-val-unit"> / {totalEq}</span></div>
            <div className={`sum-sub ${running === totalEq && totalEq > 0 ? 'ok' : running > 0 ? 'warn' : 'up'}`}>
              {running === totalEq && totalEq > 0 ? '✓ All running' : `${totalEq - running} offline`}
            </div>
          </div>
        </div>

        {/* Active Alarms */}
        <div className="sum-card">
          <div className={`sum-ico ${critAlarms > 0 ? 'r' : activeAlarms > 0 ? 'o' : 'g'}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 01-3.46 0"/>
            </svg>
          </div>
          <div>
            <div className="sum-lbl">Active Alarms</div>
            <div className="sum-val">{activeAlarms}</div>
            <div className={`sum-sub ${critAlarms > 0 ? 'up' : activeAlarms > 0 ? 'warn' : 'ok'}`}>
              {activeAlarms === 0 ? '✓ All clear' : `${critAlarms} critical · ${warnAlarms} warn`}
            </div>
          </div>
        </div>

        {/* Avg Health */}
        <div className="sum-card">
          <div className={`sum-ico ${Number(avgHealth) >= 70 ? 'g' : Number(avgHealth) >= 40 ? 'o' : 'r'}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <div>
            <div className="sum-lbl">Avg Health Score</div>
            <div className="sum-val">{avgHealth}<span className="sum-val-unit">%</span></div>
            <div className={`sum-sub ${Number(avgHealth) >= 70 ? 'ok' : Number(avgHealth) >= 40 ? 'warn' : 'up'}`}>
              {Number(avgHealth) >= 70 ? '✓ Good condition' : Number(avgHealth) >= 40 ? '⚠ Monitor closely' : '✗ Action needed'}
            </div>
          </div>
        </div>

        {/* ML Service */}
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
              {mlStatus?.ok ? `${mlStatus.models_loaded || 0} models loaded` : 'Service unavailable'}
            </div>
          </div>
        </div>

        {/* Sensor Dataset */}
        <div className="sum-card">
          <div className="sum-ico c">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </div>
          <div>
            <div className="sum-lbl">Sensor Dataset</div>
            <div className="sum-val">{totalSensors || CSV_SENSORS.length}</div>
            <div className="sum-sub ok">
              {brokenCount > 0 ? `${brokenCount} broken` : recoveringCount > 0 ? `${recoveringCount} recovering` : '✓ All normal'}
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 1 — Equipment Health | Bar Gauges | 2 Sensor Charts
      ══════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px 1fr 1fr', gap: 12, minHeight: 240 }}>

        {/* Equipment Health Table */}
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
                  <th>Health</th>
                  <th style={{ textAlign: 'right' }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {healthTableData.map(eq => {
                  const h = Number(eq.health_score) || 0;
                  const { cls, bar } = healthColor(h);
                  return (
                    <tr key={eq.id}>
                      <td><code style={{ fontSize: 11 }}>{eq.tag}</code></td>
                      <td>
                        <span className={`badge ${
                          eq.status === 'running'     ? 'ok'   :
                          eq.status === 'fault'       ? 'bad'  :
                          eq.status === 'maintenance' ? 'warn' : 'idle'
                        }`}>{eq.status}</span>
                      </td>
                      <td>
                        <div style={{ width: 56, height: 5, background: 'var(--g-softer)', borderRadius: 3, overflow: 'hidden', border: '1px solid var(--border)' }}>
                          <div style={{ width: `${h}%`, height: '100%', background: bar, borderRadius: 2, transition: 'width .4s' }} />
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={`pct-cell ${cls}`}>{h.toFixed(0)}%</span>
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

        {/* Live Sensor Bar Gauges */}
        <div className="panel">
          <div className="panel-head">
            <span className="title">Live Sensor Readings</span>
            <span className="menu">⋯</span>
          </div>
          <div className="panel-body" style={{ padding: '8px 10px', gap: 6, flex: 1 }}>
            {gaugeReadings.map((r, i) => (
              <BarGauge key={i} label={r.label} pct={r.pct} value={r.value} unit={r.unit} />
            ))}
          </div>
        </div>

        {/* Sensor Chart — Vibration & Pressure (live) */}
        <GrafanaPanel
          title="Vib. & Pressure"
          sub="mm/s · bar"
          unit=""
          height={160}
          datasets={CSV_SENSORS.slice(0, 2).map(s => ({
            key:   s.key,
            label: s.label,
            color: s.color,
            data:  mergedSeries[s.key] || [],
          }))}
        />

        {/* Sensor Chart — Temperature (live) */}
        <GrafanaPanel
          title="Temperature Sensors"
          sub="°C"
          unit="°C"
          height={160}
          datasets={CSV_SENSORS.slice(2, 4).map(s => ({
            key:   s.key,
            label: s.label,
            color: s.color,
            data:  mergedSeries[s.key] || [],
          }))}
        />
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 2 — 3 Grafana trend panels (groups of 3 sensors)
      ══════════════════════════════════════════════════════════ */}
      <div style={{
        fontSize: 10.5, fontWeight: 700, color: 'var(--tm)',
        letterSpacing: '.6px', textTransform: 'uppercase',
        borderLeft: '3px solid var(--g)', paddingLeft: 10,
      }}>
        Sensor Trends — Live · {Object.values(mergedSeries).reduce((s, d) => s + d.length, 0).toLocaleString()} data points
      </div>

      <div className="grid-3">
        {panelGroups.map((pg, gi) => (
          <GrafanaPanel
            key={gi}
            title={pg.title}
            sub={pg.sub}
            height={145}
            datasets={pg.sensors.map(s => ({
              key:   s.key,
              label: s.label,
              color: s.color,
              data:  mergedSeries[s.key] || [],
            }))}
          />
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 3 — Health Distribution + Predictive Analytics
      ══════════════════════════════════════════════════════════ */}
      <div className="grid-2">
        <HealthDistPanel equipment={health?.equipment || []} />

        {/* Predictive Analytics summary */}
        <div className="panel">
          <div className="panel-head">
            <span className="title">Predictive Analytics Summary</span>
            <span className="menu">⋯</span>
          </div>
          <div className="panel-body" style={{ gap: 10 }}>
            {(health?.equipment || []).length === 0 ? (
              <div style={{ color: 'var(--td)', fontSize: 12, textAlign: 'center', padding: 16 }}>
                Loading predictive data…
              </div>
            ) : (
              <>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: .5 }}>
                  Fleet Health Profile
                </div>
                <ResponsiveContainer width="100%" height={115}>
                  <AreaChart
                    data={(health?.equipment || []).slice(0, 12).map((eq, i) => ({
                      name: eq.tag?.split('_').slice(-1)[0] || `E${i}`,
                      health: Number(eq.health_score) || 0,
                    }))}
                    margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="health-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={C.green} stopOpacity={0.28} />
                        <stop offset="95%" stopColor={C.green} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={GRID_CLR} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={28}
                      tickFormatter={v => `${v}%`} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #ddd', borderRadius: 5, fontSize: 11 }}
                      formatter={(v) => [`${v}%`, 'Health Score']} />
                    <ReferenceLine y={70} stroke={C.yellow} strokeDasharray="4 2" />
                    <ReferenceLine y={40} stroke={C.red} strokeDasharray="4 2" />
                    <Area type="monotone" dataKey="health" stroke={C.green} fill="url(#health-area)"
                      strokeWidth={1.8} dot={{ r: 2.5, fill: C.green, stroke: '#fff', strokeWidth: 1 }}
                      isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>

                {/* CSV machine status summary */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 4 }}>
                  {[
                    { label: 'Avg Health',   value: `${avgHealth}%`,         color: Number(avgHealth) >= 70 ? C.green : C.yellow },
                    { label: 'Machine State',value: brokenCount > 0 ? `${brokenCount} BROKEN` : recoveringCount > 0 ? `${recoveringCount} RECOV.` : 'NORMAL', color: brokenCount > 0 ? C.red : recoveringCount > 0 ? C.orange : C.green },
                    { label: 'Active Alarms',value: activeAlarms,             color: activeAlarms === 0 ? C.green : critAlarms > 0 ? C.red : C.yellow },
                  ].map(s => (
                    <div key={s.label} style={{
                      background: 'var(--g-softer)', borderRadius: 6, padding: '8px 10px',
                      border: '1px solid var(--border)',
                    }}>
                      <div style={{ fontSize: 10, color: 'var(--td)', textTransform: 'uppercase', letterSpacing: .5 }}>{s.label}</div>
                      <div style={{ fontSize: 17, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>
                        {s.value}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
