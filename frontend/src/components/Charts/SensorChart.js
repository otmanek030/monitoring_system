/**
 * SensorChart — measurement-aware dark-themed Recharts component.
 *
 * Picks visual style from `measurement`:
 *   temperature  → gradient area (orange)
 *   vibration    → spike line with colored dots (purple → red on alarm)
 *   pressure     → gradient area (blue)
 *   flow         → gradient area (teal)
 *   current      → gradient area (amber)
 *   speed        → gradient area (violet)
 *   level        → deep-fill area + live % badge (cyan)
 *   ph           → zone-coloured chart with bands (pink)
 *   density      → plain line (slate)
 *   position     → plain line (indigo)
 *   tension      → gradient area (yellow)
 *   <other>      → plain line (fern green)
 *
 * When `data` rows include `.min` and `.max`, a semi-transparent
 * min-max band is drawn behind the main line/area.
 */
import React, { useMemo, useId } from 'react';
import {
  AreaChart, Area,
  LineChart, Line,
  ComposedChart,
  XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts';

/* ── Measurement → style ───────────────────────────────────── */
const STYLE = {
  temperature: { color: '#f2945a', fill: true,  label: 'Temperature' },
  vibration:   { color: '#b085dc', fill: false, label: 'Vibration',  special: 'vibration' },
  pressure:    { color: '#6ea0e6', fill: true,  label: 'Pressure' },
  flow:        { color: '#5ec8d1', fill: true,  label: 'Flow' },
  current:     { color: '#e8c770', fill: true,  label: 'Current' },
  speed:       { color: '#b085dc', fill: true,  label: 'Speed' },
  level:       { color: '#5ec8d1', fill: true,  label: 'Level',     special: 'level' },
  ph:          { color: '#e07ac2', fill: true,  label: 'pH',        special: 'ph' },
  density:     { color: '#7a968a', fill: false, label: 'Density' },
  position:    { color: '#6ea0e6', fill: false, label: 'Position' },
  tension:     { color: '#e8c770', fill: true,  label: 'Tension' },
};
const DEFAULT_STYLE = { color: '#52b788', fill: false, label: '' };

/* ── Light-theme axis + tooltip ─────────────────────────────── */
const AXIS_TICK  = { fill: 'var(--tm)', fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace" };
const GRID_COLOR = 'var(--border)';

/* ── X-axis label formatter ─────────────────────────────────── */
function makeXFormatter(data) {
  if (!data?.length < 2) return () => '';
  const span = new Date(data[data.length - 1].ts) - new Date(data[0].ts);
  if (span <= 3_600_000)
    return (ts) => new Date(ts).toLocaleTimeString([], { hour12: false });
  if (span <= 24 * 3_600_000)
    return (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return (ts) => {
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}h`;
  };
}

/* ── Custom light tooltip ────────────────────────────────────── */
function DarkTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  const main = payload.find(p => p.dataKey === 'value');
  const hasRange = payload.find(p => p.dataKey === 'max');
  return (
    <div style={{
      background: '#fff',
      border: '1px solid var(--g-soft)',
      borderRadius: 5,
      padding: '7px 11px',
      fontSize: 11.5,
      color: 'var(--tx)',
      boxShadow: '0 2px 12px rgba(0,0,0,.1)',
    }}>
      <div style={{ color: 'var(--tm)', fontSize: 10.5, marginBottom: 3 }}>
        {new Date(label).toLocaleString()}
      </div>
      {main && (
        <div style={{
          color: main.stroke || main.color,
          fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {Number(main.value).toFixed(2)} {unit}
        </div>
      )}
      {hasRange && (
        <div style={{ color: 'var(--tm)', fontSize: 10.5, marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>
          Range: {Number(payload.find(p=>p.dataKey==='min')?.value||0).toFixed(2)} – {Number(hasRange.value).toFixed(2)} {unit}
        </div>
      )}
    </div>
  );
}

/* ── Vibration dot renderer ─────────────────────────────────── */
function VibrationDot({ cx, cy, value, h1, h2 }) {
  if (value == null || cx == null || cy == null) return null;
  const color = h2 != null && value >= h2 ? '#e05a5a'
              : h1 != null && value >= h1 ? '#e8c770'
              : '#52b788';
  return <circle cx={cx} cy={cy} r={2.5} fill={color} stroke="none" />;
}

/* ── Threshold reference lines ──────────────────────────────── */
function ThresholdLines({ thresholds = {} }) {
  const { h1, h2, l1, l2 } = thresholds;
  return <>
    {h2 != null && <ReferenceLine y={h2} stroke="#e05a5a" strokeDasharray="5 3" strokeWidth={1} label={{ value: 'H2', fill: '#e05a5a', fontSize: 9.5, position: 'right' }} />}
    {h1 != null && <ReferenceLine y={h1} stroke="#e8c770" strokeDasharray="5 3" strokeWidth={1} label={{ value: 'H1', fill: '#e8c770', fontSize: 9.5, position: 'right' }} />}
    {l1 != null && <ReferenceLine y={l1} stroke="#e8c770" strokeDasharray="5 3" strokeWidth={1} label={{ value: 'L1', fill: '#e8c770', fontSize: 9.5, position: 'right' }} />}
    {l2 != null && <ReferenceLine y={l2} stroke="#e05a5a" strokeDasharray="5 3" strokeWidth={1} label={{ value: 'L2', fill: '#e05a5a', fontSize: 9.5, position: 'right' }} />}
  </>;
}

/* ── Y-domain helper ────────────────────────────────────────── */
function computeYDomain(data, thresholds = {}) {
  if (!data?.length) return ['auto', 'auto'];
  const vals = data.flatMap(d => [d.value, d.min, d.max].filter(v => v != null));
  const refs  = [thresholds.h1, thresholds.h2, thresholds.l1, thresholds.l2].filter(v => v != null);
  const all   = [...vals, ...refs];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.14 || 1;
  return [lo - pad, hi + pad];
}

/* ═══════════════ Main component ═══════════════════════════════ */
export default function SensorChart({
  sensorId,
  measurement = '',
  title = '',
  unit = '',
  data = [],
  thresholds = {},
  height = 220,
  live = false,
}) {
  const uid    = useId().replace(/:/g, '');
  const gradId = `${uid}-${sensorId}`;
  const style  = STYLE[measurement] || DEFAULT_STYLE;
  const isAgg  = data.length > 0 && data[0].min != null && data[0].max != null;
  const fmtX   = useMemo(() => makeXFormatter(data), [data]);
  const domain = useMemo(() => computeYDomain(data, thresholds), [data, thresholds]);

  const prepared = useMemo(() =>
    data.map(d => ({ ...d, ts: d.ts instanceof Date ? d.ts.toISOString() : d.ts })),
  [data]);

  const latest    = prepared[prepared.length - 1];
  const latestVal = latest ? Number(latest.value).toFixed(2) : '--';
  const alarm     = thresholds.h2 != null && latest?.value >= thresholds.h2 ? 'fatal'
                  : thresholds.h1 != null && latest?.value >= thresholds.h1 ? 'warning'
                  : thresholds.l2 != null && latest?.value <= thresholds.l2 ? 'fatal'
                  : thresholds.l1 != null && latest?.value <= thresholds.l1 ? 'warning'
                  : 'ok';

  const alarmColor = alarm === 'fatal'   ? '#d64545'
                   : alarm === 'warning' ? '#e88a3a'
                   : '#007a3d';

  /* ── SVG defs ── */
  const Defs = () => (
    <defs>
      <linearGradient id={`fill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor={style.color} stopOpacity={0.35} />
        <stop offset="95%" stopColor={style.color} stopOpacity={0.02} />
      </linearGradient>
      <linearGradient id={`band-${gradId}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor={style.color} stopOpacity={0.15} />
        <stop offset="95%" stopColor={style.color} stopOpacity={0.02} />
      </linearGradient>
    </defs>
  );

  /* ── Shared chart props ── */
  const commonProps = { data: prepared, margin: { top: 6, right: 26, left: 0, bottom: 0 } };
  const xAxisProps  = {
    dataKey: 'ts', tickFormatter: fmtX, tick: AXIS_TICK, minTickGap: 40,
    tickLine: false, axisLine: { stroke: GRID_COLOR },
  };
  const yAxisProps = {
    domain, tick: AXIS_TICK, width: 50,
    tickFormatter: v => Number(v).toFixed(1),
    tickLine: false, axisLine: false,
  };

  /* ── Renderers ── */
  const renderVibration = () => (
    <LineChart {...commonProps}>
      <Defs />
      <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
      <XAxis {...xAxisProps} />
      <YAxis {...yAxisProps} />
      <Tooltip content={<DarkTooltip unit={unit} />} />
      <ThresholdLines thresholds={thresholds} />
      <Line
        type="monotone" dataKey="value" stroke={style.color}
        strokeWidth={1.5} isAnimationActive={false}
        dot={(props) => (
          <VibrationDot key={props.key} cx={props.cx} cy={props.cy}
            value={props.payload?.value} h1={thresholds.h1} h2={thresholds.h2} />
        )}
        activeDot={{ r: 4, stroke: style.color, fill: '#fff', strokeWidth: 2 }}
      />
    </LineChart>
  );

  const renderLevel = () => (
    <AreaChart {...commonProps}>
      <Defs />
      <defs>
        <linearGradient id={`fill-deep-${gradId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={style.color} stopOpacity={0.6} />
          <stop offset="100%" stopColor={style.color} stopOpacity={0.08} />
        </linearGradient>
      </defs>
      <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
      <XAxis {...xAxisProps} />
      <YAxis {...yAxisProps} />
      <Tooltip content={<DarkTooltip unit={unit} />} />
      <ThresholdLines thresholds={thresholds} />
      {isAgg && (
        <Area type="monotone" dataKey="max" stroke="none"
          fill={`url(#band-${gradId})`} dot={false} activeDot={false}
          isAnimationActive={false} legendType="none" />
      )}
      <Area type="monotone" dataKey="value" stroke={style.color}
        strokeWidth={2} fill={`url(#fill-deep-${gradId})`}
        isAnimationActive={false} dot={false} />
    </AreaChart>
  );

  const renderPh = () => {
    const phZones = [
      [0, 6.5, '#e05a5a', 0.08],
      [6.5, 7.5, '#e8c770', 0.07],
      [7.5, 10.5, '#52b788', 0.06],
      [10.5, 11.0, '#e8c770', 0.07],
      [11.0, 14.0, '#e05a5a', 0.08],
    ];
    return (
      <ComposedChart {...commonProps}>
        <Defs />
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
        <XAxis {...xAxisProps} />
        <YAxis {...yAxisProps} />
        <Tooltip content={<DarkTooltip unit={unit} />} />
        {phZones.map(([y1, y2, color, opacity]) => (
          <ReferenceArea key={`${y1}-${y2}`} y1={y1} y2={y2}
            fill={color} fillOpacity={opacity} stroke="none" />
        ))}
        {isAgg && (
          <Area type="monotone" dataKey="max" stroke="none"
            fill={`url(#band-${gradId})`} dot={false} activeDot={false}
            isAnimationActive={false} legendType="none" />
        )}
        <Area type="monotone" dataKey="value" stroke={style.color}
          strokeWidth={2} fill={`url(#fill-${gradId})`}
          isAnimationActive={false} dot={false} />
        <ThresholdLines thresholds={thresholds} />
      </ComposedChart>
    );
  };

  const renderArea = () => (
    <AreaChart {...commonProps}>
      <Defs />
      <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
      <XAxis {...xAxisProps} />
      <YAxis {...yAxisProps} />
      <Tooltip content={<DarkTooltip unit={unit} />} />
      <ThresholdLines thresholds={thresholds} />
      {isAgg && (
        <Area type="monotone" dataKey="max" stroke="none"
          fill={`url(#band-${gradId})`} dot={false} activeDot={false}
          isAnimationActive={false} legendType="none" />
      )}
      {isAgg && (
        <Area type="monotone" dataKey="min" stroke="none"
          fill="transparent" dot={false} activeDot={false}
          isAnimationActive={false} legendType="none" />
      )}
      <Area type="monotone" dataKey="value" stroke={style.color}
        strokeWidth={1.8} fill={`url(#fill-${gradId})`}
        isAnimationActive={false} dot={false}
        activeDot={{ r: 4, stroke: style.color, fill: '#fff', strokeWidth: 2 }} />
    </AreaChart>
  );

  const renderLine = () => (
    <LineChart {...commonProps}>
      <Defs />
      <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
      <XAxis {...xAxisProps} />
      <YAxis {...yAxisProps} />
      <Tooltip content={<DarkTooltip unit={unit} />} />
      <ThresholdLines thresholds={thresholds} />
      <Line type="monotone" dataKey="value" stroke={style.color}
        strokeWidth={1.8} dot={false} isAnimationActive={false}
        activeDot={{ r: 4, stroke: style.color, fill: '#fff', strokeWidth: 2 }} />
    </LineChart>
  );

  const renderChart = () => {
    if (style.special === 'vibration') return renderVibration();
    if (style.special === 'level')     return renderLevel();
    if (style.special === 'ph')        return renderPh();
    if (style.fill)                    return renderArea();
    return renderLine();
  };

  /* ── Panel wrapper ── */
  return (
    <div className="panel" style={{ position: 'relative' }}>
      {/* Panel head */}
      <div className="panel-head">
        {live && <span className="sdot" style={{ marginRight: 2 }} />}
        <span className="title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        {latest && (
          <span style={{
            marginLeft: 6,
            fontSize: 11.5,
            fontFamily: "'JetBrains Mono', monospace",
            color: alarmColor,
            fontWeight: 700,
            flexShrink: 0,
          }}>
            {latestVal}
            <span style={{ color: 'var(--tm)', fontWeight: 400, marginLeft: 2 }}>{unit}</span>
          </span>
        )}
        {data.length > 0 && (
          <span style={{ fontSize: 9.5, color: 'var(--td)', marginLeft: 4, flexShrink: 0 }}>
            {data.length}pt
          </span>
        )}
        <span className="menu">⋯</span>
      </div>

      {/* Chart area */}
      {prepared.length === 0 ? (
        <div style={{
          height, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--tm)', fontSize: 12.5,
        }}>
          No data for selected period
        </div>
      ) : (
        <div style={{ width: '100%', height, padding: '6px 0 4px' }}>
          <ResponsiveContainer>
            {renderChart()}
          </ResponsiveContainer>
        </div>
      )}

      {/* Aggregated range note */}
      {isAgg && (
        <div style={{ padding: '2px 12px 5px', fontSize: 9.5, color: 'var(--td)', textAlign: 'right' }}>
          Band = min/max per bucket
        </div>
      )}
    </div>
  );
}
