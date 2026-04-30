/**
 * Dashboard — OCP PhosWatch real-time overview.
 *
 * Layout:
 *   TOP STRIP   — 5 KPI cards
 *   ROW 1       — Equipment Health table | Live Sensor Readings bar-gauges | 2 sensor trend charts
 *   ROW 2       — 3 Grafana-style multi-series trend panels
 *   ROW 3       — Health Distribution pie + Predictive Analytics summary
 *
 * Live streaming:
 *   • On mount we pick a "featured" sensor list from the backend
 *     (via /api/equipment/health which returns sensors[]).
 *   • For each featured sensor we ALSO fetch ~last hour of historical
 *     readings from /api/sensors/:id/readings so charts are populated
 *     immediately and live points append on top.
 *   • The Socket.io 'reading' event (sensor_id, value, ts) appends to a
 *     per-sensor ring buffer; charts refresh in <500ms.
 *
 * Active alarms panel was removed — it has its own dedicated /alarms page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Equipment, Alarms, Predictions, Sensors } from '../services/api';
import { useLiveFeed } from '../services/websocket';
import TimeRangePicker, { getRangeParams, filterPointsToRange } from '../components/Charts/TimeRangePicker';
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
const PALETTE = [C.orange, C.blue, C.red, C.cyan, C.purple, C.green2, C.yellow, C.greenL, C.green];

const AXIS_TICK = { fill: '#a8b9b0', fontSize: 9.5, fontFamily: "'JetBrains Mono', monospace" };
const GRID_CLR  = 'rgba(0,122,61,.07)';

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
  if (!datasets.length) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span className="title">{title}</span>
          {sub && <span className="sub" style={{ fontSize: 10.5, color: 'var(--td)', marginLeft: 4 }}>{sub}</span>}
          <span className="menu">⋯</span>
        </div>
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--td)', fontSize: 11.5 }}>
          Waiting for data…
        </div>
      </div>
    );
  }

  const stats = datasets.map(ds => {
    const vals = ds.data.map(d => d.value).filter(v => v != null && !isNaN(v));
    const cur  = vals[vals.length - 1] ?? '--';
    const max  = vals.length ? Math.max(...vals) : '--';
    const avg  = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : '--';
    const fmt  = v => v === '--' ? '--' : v.toFixed(3);
    return { label: ds.label, color: ds.color, max: fmt(max), avg: fmt(avg), cur: fmt(cur) };
  });

  // Merge time series so every dataset shares the same X-axis.
  const allTs = [...new Set(datasets.flatMap(ds => ds.data.map(d => d.ts)))].sort((a, b) => a - b);
  const merged = allTs.map(ts => {
    const row = {
      ts,
      label: new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    };
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

/* ─── Segmented bar gauge — uses .bg-row CSS so it stays responsive ── */
function BarGauge({ label, pct = 0, value, unit = '' }) {
  const clampedPct = Math.max(0, Math.min(100, pct));
  const color = clampedPct > 85 ? C.red : clampedPct > 70 ? C.orange : clampedPct > 50 ? C.yellow : C.green;
  const cls   = clampedPct > 85 ? 'red' : clampedPct > 70 ? 'orange' : clampedPct > 50 ? 'yellow' : 'green';
  return (
    <div className="bg-row" title={label}>
      <div className="bg-label">{label}</div>
      <div className="bg-track">
        <div className="bg-fill" style={{ width: `${clampedPct}%`, background: color }} />
      </div>
      <div className={`bg-val ${cls}`}>
        <span>{typeof value === 'number' ? value.toFixed(2) : '--'}</span>
        <span style={{ fontSize: 9.5, color: 'var(--td)', fontWeight: 400 }}>{unit}</span>
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
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div className="panel-head">
        <span className="title">Health Distribution</span>
        <span style={{ fontSize: 10.5, color: 'var(--tm)', marginLeft: 4 }}>{equipment.length} assets</span>
        <span className="menu">⋯</span>
      </div>

      {/* Pie + legend stack vertically so the component stays usable inside
          a narrow column. Pie scales with ResponsiveContainer (width 100%). */}
      <div style={{ padding: '4px 10px 6px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <ResponsiveContainer width="100%" height={130}>
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%" innerRadius={32} outerRadius={56}
              dataKey="value" isAnimationActive={false}
              label={({ percent }) => `${Math.round(percent * 100)}%`} labelLine={false}>
              {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % 3]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: '#fff', border: '1px solid #ddd', borderRadius: 5, fontSize: 11 }}
              formatter={(v, n) => [v + ' assets', n]} />
          </PieChart>
        </ResponsiveContainer>

        {/* Legend chips */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          {pieData.map((d, i) => (
            <span key={d.name} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, color: 'var(--tm)',
              background: 'var(--g-softer)', border: '1px solid var(--border)',
              padding: '1px 6px', borderRadius: 4,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: PIE_COLORS[i % 3] }} />
              {d.name}: <strong>{d.value}</strong>
            </span>
          ))}
        </div>

        {/* Attention required — top 5 worst, full-width rows */}
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 5 }}>
            Attention Required
          </div>
          {worst.map(eq => {
            const h = Number(eq.health_score) || 0;
            const col = h >= 70 ? C.green : h >= 40 ? C.yellow : C.red;
            return (
              <div key={eq.id} style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(60px, 1fr) 60px 36px',
                alignItems: 'center', gap: 6, marginBottom: 4, minWidth: 0,
              }}>
                <code style={{
                  fontSize: 10.5, color: 'var(--tm)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }} title={eq.tag}>{eq.tag}</code>
                <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${h}%`, height: '100%', background: col, borderRadius: 3, transition: 'width .4s' }} />
                </div>
                <span style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace", color: col, fontWeight: 700, textAlign: 'right' }}>
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
  const [alarmStats, setAlarmStats] = useState(null);
  const [mlStatus,   setMlStatus]   = useState(null);
  const [error,      setError]      = useState('');
  const [range,      setRange]      = useState('1h');
  const [loading,    setLoading]    = useState(false);

  /* ── Featured sensors (≤9 picked from backend health overview) ── */
  const [featuredSensors, setFeaturedSensors] = useState([]);

  /* ── Live feed (Socket.io) ── */
  const { readings: liveReadings, latestAlarm, connected, seedHistorical } =
    useLiveFeed({ bufferSize: 600 });

  /* ── KPI loader ── */
  const loadKPIs = useCallback(async () => {
    try {
      setLoading(true);
      const [h, s, m] = await Promise.all([
        Equipment.health(),
        Alarms.stats(),
        Predictions.mlHealth().catch(() => ({ ok: false })),
      ]);
      setHealth(h);
      setAlarmStats(s);
      setMlStatus(m);
      setError('');
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadKPIs(); }, [loadKPIs]);
  useEffect(() => { const t = setInterval(loadKPIs, 30_000); return () => clearInterval(t); }, [loadKPIs]);
  useEffect(() => { if (latestAlarm) loadKPIs(); }, [latestAlarm, loadKPIs]);

  /* ── Pick 9 featured sensors from health.equipment[].sensors[] ── */
  useEffect(() => {
    if (!health?.equipment?.length) return;
    const picked = [];
    // Prefer one sensor per equipment so the chart panels are diverse
    for (const eq of health.equipment) {
      if (picked.length >= 9) break;
      const s = eq.sensors?.[0];
      if (s) {
        picked.push({
          ...s,
          id: s.id ?? s.sensor_id,
          equipment_tag: eq.tag,
          equipment_id: eq.id,
        });
      }
    }
    // If still not enough, pull more sensors per equipment
    if (picked.length < 9) {
      for (const eq of health.equipment) {
        for (const s of (eq.sensors || []).slice(1)) {
          if (picked.length >= 9) break;
          picked.push({
            ...s,
            id: s.id ?? s.sensor_id,
            equipment_tag: eq.tag,
            equipment_id: eq.id,
          });
        }
      }
    }
    setFeaturedSensors(picked);
  }, [health]);

  /* ── Seed each featured sensor's ring buffer with REST history.
       Window + bucket are driven by the active TimeRangePicker selection,
       so e.g. picking "7d" replays a week's worth of 1-hour buckets. ── */
  useEffect(() => {
    if (!featuredSensors.length) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const params = getRangeParams(range);
      const seed = {};
      await Promise.all(featuredSensors.map(async (s) => {
        try {
          const r = await Sensors.readings(s.id, {
            from:   params.from,
            to:     params.to,
            bucket: params.live ? 'raw' : params.bucket,
            limit:  range === 'all' ? 5000 : 1500,
          });
          seed[s.id] = (r.points || []).map(p => ({
            ts: new Date(p.ts || p.bucket).getTime(),
            value: Number(p.value),
          })).filter(p => !isNaN(p.value));
        } catch {
          seed[s.id] = [];
        }
      }));
      if (cancelled) return;
      seedHistorical(seed);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [featuredSensors, range, seedHistorical]);

  /* ── Build per-sensor merged series (history + live), then clamp to
       the selected window so charts never show data outside it. ── */
  const seriesById = useMemo(() => {
    const out = {};
    featuredSensors.forEach((s) => {
      const buf = liveReadings[s.id] || [];
      const points = buf.map(pt => ({
        ts: typeof pt.ts === 'number' ? pt.ts : new Date(pt.ts).getTime(),
        value: Number(pt.value),
      })).filter(p => !isNaN(p.value));
      out[s.id] = filterPointsToRange(points, range);
    });
    return out;
  }, [featuredSensors, liveReadings, range]);


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

  /* ── Bar gauges: take the first 6 featured sensors ── */
  const gaugeReadings = featuredSensors.slice(0, 6).map((s, i) => {
    const data = seriesById[s.id] || [];
    const last = data[data.length - 1];
    const val  = last?.value ?? null;
    const lo   = Number(s.range_min ?? s.l1 ?? 0);
    const hi   = Number(s.range_max ?? s.h2 ?? 100);
    const span = Math.max(0.0001, hi - lo);
    const pct  = val != null ? Math.max(0, Math.min(100, ((val - lo) / span) * 100)) : 0;
    return {
      key: s.id,
      label: s.tag || s.tag_code || s.name || `S${i}`,
      value: val,
      pct,
      unit: s.unit || '',
    };
  });

  /* ── Total live points across all sensors ── */
  const totalPoints = Object.values(seriesById).reduce((sum, arr) => sum + arr.length, 0);

  /* ── Build datasets for the panels ── */
  const buildDatasets = (sensors) => sensors.map((s, i) => {
    const data = seriesById[s.id] || [];
    return {
      key:   `s${s.id}`,
      label: s.tag || s.name || `Sensor ${s.id}`,
      color: PALETTE[i % PALETTE.length],
      data,
    };
  });

  const panel1 = featuredSensors.slice(0, 2);
  const panel2 = featuredSensors.slice(2, 4);
  const panelGroups = [
    { title: 'Group 1', sub: 'sensors 1-3',  sensors: featuredSensors.slice(0, 3) },
    { title: 'Group 2', sub: 'sensors 4-6',  sensors: featuredSensors.slice(3, 6) },
    { title: 'Group 3', sub: 'sensors 7-9',  sensors: featuredSensors.slice(6, 9) },
  ].filter(g => g.sensors.length > 0);

  /* ─── Render ──────────────────────────────────────────────────── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Connection status + time range */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className={`sdot${connected ? '' : ' warn'}`} />
          <span style={{ fontSize: 12, color: 'var(--tm)' }}>
            {connected ? 'WebSocket live' : 'Reconnecting…'}
          </span>
          {loading && <span style={{ fontSize: 11, color: 'var(--td)' }}>Loading…</span>}
          <span style={{ fontSize: 11, color: 'var(--td)', background: 'var(--g-softer)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 4 }}>
            {connected ? '🟢 Live' : '⚪ Offline'} · {totalPoints.toLocaleString()} pts · {featuredSensors.length} sensors
          </span>
          {/* Active window indicator */}
          <span style={{ fontSize: 11, color: 'var(--tm)', background: '#fff', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 4, fontFamily: "'JetBrains Mono', monospace" }}>
            {(() => {
              const p = getRangeParams(range);
              return `${new Date(p.from).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })} → ${new Date(p.to).toLocaleString('en-GB', { hour:'2-digit', minute:'2-digit' })}`;
            })()}
          </span>
        </div>
        <TimeRangePicker value={range} onChange={setRange} disabled={loading} />
      </div>

      {error && (
        <div className="error">
          ⚠ {error} — verify Docker containers are running (<code>docker compose up -d</code>)
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TOP STRIP — 5 KPI cards (Active Alarms removed; see /alarms)
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

        {/* Sensor count */}
        <div className="sum-card">
          <div className="sum-ico c">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </div>
          <div>
            <div className="sum-lbl">Active Sensors</div>
            <div className="sum-val">{totalSensors}</div>
            <div className="sum-sub ok">
              streaming live
            </div>
          </div>
        </div>

        {/* Live data points */}
        <div className="sum-card">
          <div className={`sum-ico ${connected ? 'b' : 'o'}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M3 12h4l3-9 4 18 3-9h4"/>
            </svg>
          </div>
          <div>
            <div className="sum-lbl">Live Data Points</div>
            <div className="sum-val">{totalPoints.toLocaleString()}</div>
            <div className={`sum-sub ${connected ? 'ok' : 'warn'}`}>
              {connected ? '✓ Streaming' : '⚠ Offline'}
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 1 — Equipment Health | Live Sensor Readings |
                   Health Distribution | Live Trend
          Wraps to 2×2 below 1100 px, single column below 720 px.
      ══════════════════════════════════════════════════════════ */}
      <div className="dashboard-row-1" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 12, minHeight: 260,
      }}>

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
            {gaugeReadings.length === 0 ? (
              <div style={{ color: 'var(--td)', fontSize: 11.5, padding: 8 }}>Waiting for sensor data…</div>
            ) : gaugeReadings.map((r) => (
              <BarGauge key={r.key} label={r.label} pct={r.pct} value={r.value} unit={r.unit} />
            ))}
          </div>
        </div>

        {/* Health Distribution — moved here so it's next to Live Sensor Readings */}
        <HealthDistPanel equipment={health?.equipment || []} />

        {/* Live Trend — first two sensors */}
        <GrafanaPanel
          title="Live Trend"
          sub={panel1.map(s => s.tag).join(' · ')}
          height={170}
          datasets={buildDatasets(panel1)}
        />
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 2 — 3 Grafana trend panels
      ══════════════════════════════════════════════════════════ */}
      <div style={{
        fontSize: 10.5, fontWeight: 700, color: 'var(--tm)',
        letterSpacing: '.6px', textTransform: 'uppercase',
        borderLeft: '3px solid var(--g)', paddingLeft: 10,
      }}>
        Sensor Trends — Live · {totalPoints.toLocaleString()} data points · updates &lt;500ms
      </div>

      <div className="grid-3">
        {panelGroups.map((pg, gi) => (
          <GrafanaPanel
            key={gi}
            title={pg.title}
            sub={pg.sensors.map(s => s.tag).join(' · ')}
            height={120}                       /* compact, matches Live Trend */
            datasets={buildDatasets(pg.sensors)}
          />
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 3 — Live Trend (Group B) + Predictive Analytics
          (Health Distribution moved to ROW 1; Active Alarms panel
           removed - see dedicated /alarms page)
      ══════════════════════════════════════════════════════════ */}
      <div className="grid-2">
        <GrafanaPanel
          title="Live Trend — Group B"
          sub={panel2.map(s => s.tag).join(' · ')}
          height={180}
          datasets={buildDatasets(panel2)}
        />

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

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 4 }}>
                  {[
                    { label: 'Avg Health',     value: `${avgHealth}%`, color: Number(avgHealth) >= 70 ? C.green : C.yellow },
                    { label: 'Critical Alarms',value: critAlarms,      color: critAlarms > 0 ? C.red : C.green },
                    { label: 'Warnings',       value: warnAlarms,      color: warnAlarms > 0 ? C.yellow : C.green },
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
