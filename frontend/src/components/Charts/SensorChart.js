/**
 * SensorChart — measurement-aware Recharts component.
 *
 * Picks the right visual style automatically from `measurement`:
 *   temperature  → gradient area (orange)
 *   vibration    → spike line with value-coloured dots (purple → red on alarm)
 *   pressure     → gradient area (blue)
 *   flow         → gradient area (teal)
 *   current      → gradient area (amber)
 *   speed        → gradient area (violet)
 *   level        → deep-fill area + live % badge (cyan)
 *   ph           → zone-coloured chart with good/warn/danger bands (pink)
 *   density      → plain line (slate)
 *   position     → plain line (indigo)
 *   tension      → gradient area (yellow)
 *   <other>      → plain line (accent blue)
 *
 * When `data` rows include `.min` and `.max` (aggregated buckets), a
 * semi-transparent min-max band is drawn behind the main line/area.
 *
 * Props
 * ─────
 *   sensorId    {number}  unique ID — used to make SVG gradient IDs collision-free
 *   measurement {string}  one of the types above
 *   title       {string}  displayed in the card header
 *   unit        {string}  engineering unit label
 *   data        {Array}   [{ts, value, min?, max?}]
 *   thresholds  {Object}  {h1, h2, l1, l2}  — drawn as ReferenceLine dashes
 *   height      {number}  chart height in px (default 220)
 *   live        {bool}    show a pulsing green dot when true
 */
import React, { useMemo, useId } from 'react';
import {
  AreaChart, Area,
  LineChart, Line,
  ComposedChart,
  XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts';
// Note: <defs>, <linearGradient>, <stop> are native SVG elements used inside
// Recharts chart children — they are NOT exported from the recharts package.

// ─── Measurement → visual style map ─────────────────────────────────────────
const STYLE = {
  temperature: { color: '#f97316', fill: true,  label: 'Temperature' },
  vibration:   { color: '#c084fc', fill: false, label: 'Vibration',  special: 'vibration' },
  pressure:    { color: '#60a5fa', fill: true,  label: 'Pressure' },
  flow:        { color: '#2dd4bf', fill: true,  label: 'Flow' },
  current:     { color: '#fb923c', fill: true,  label: 'Current' },
  speed:       { color: '#a78bfa', fill: true,  label: 'Speed' },
  level:       { color: '#22d3ee', fill: true,  label: 'Level',     special: 'level' },
  ph:          { color: '#f472b6', fill: true,  label: 'pH',        special: 'ph' },
  density:     { color: '#94a3b8', fill: false, label: 'Density' },
  position:    { color: '#818cf8', fill: false, label: 'Position' },
  tension:     { color: '#facc15', fill: true,  label: 'Tension' },
};
const DEFAULT_STYLE = { color: '#4da3ff', fill: false, label: '' };

// ─── Shared axis / tooltip styles ────────────────────────────────────────────
const AXIS_TICK  = { fill: '#7b8799', fontSize: 11 };
const TT_STYLE   = { background: '#121a2b', border: '1px solid #25314a', fontSize: 12 };
const TT_LABEL   = { color: '#cfd8e6' };
const GRID_COLOR = '#1c2538';

// ─── X-axis label formatter (adapts to data density) ─────────────────────────
function makeXFormatter(data) {
  if (!data || data.length < 2) return (ts) => '';
  const span = new Date(data[data.length - 1].ts) - new Date(data[0].ts);
  if (span <= 3_600_000)           // ≤ 1 h → HH:mm:ss
    return (ts) => new Date(ts).toLocaleTimeString([], { hour12: false });
  if (span <= 24 * 3_600_000)      // ≤ 1 d → HH:mm
    return (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  // > 1 d → DD/MM HH:mm
  return (ts) => {
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} `
         + `${String(d.getHours()).padStart(2,'0')}h`;
  };
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  const main = payload.find(p => p.dataKey === 'value');
  const hasRange = payload.find(p => p.dataKey === 'max');
  return (
    <div style={{ ...TT_STYLE, padding: '8px 12px', borderRadius: 6 }}>
      <div style={{ color: '#8aa0c6', fontSize: 11, marginBottom: 4 }}>
        {new Date(label).toLocaleString()}
      </div>
      {main && (
        <div style={{ color: main.color, fontWeight: 600 }}>
          {Number(main.value).toFixed(2)} {unit}
        </div>
      )}
      {hasRange && (
        <div style={{ color: '#7b8799', fontSize: 11, marginTop: 2 }}>
          Range: {Number(payload.find(p=>p.dataKey==='min')?.value||0).toFixed(2)}
          {' – '}
          {Number(hasRange.value).toFixed(2)} {unit}
        </div>
      )}
    </div>
  );
}

// ─── Vibration — coloured dot renderer ───────────────────────────────────────
function VibrationDot({ cx, cy, value, h1, h2 }) {
  if (value == null || cx == null || cy == null) return null;
  const color = h2 != null && value >= h2 ? '#ef4757'
              : h1 != null && value >= h1 ? '#f0a83a'
              : '#2cd08c';
  return <circle cx={cx} cy={cy} r={3} fill={color} stroke="none" />;
}

// ─── Shared threshold reference lines ─────────────────────────────────────────
function ThresholdLines({ thresholds = {} }) {
  const { h1, h2, l1, l2 } = thresholds;
  return <>
    {h2 != null && <ReferenceLine y={h2} stroke="#ef4757" strokeDasharray="5 3" strokeWidth={1.5} label={{ value: 'H2', fill: '#ef4757', fontSize: 10, position: 'right' }} />}
    {h1 != null && <ReferenceLine y={h1} stroke="#f0a83a" strokeDasharray="5 3" strokeWidth={1.5} label={{ value: 'H1', fill: '#f0a83a', fontSize: 10, position: 'right' }} />}
    {l1 != null && <ReferenceLine y={l1} stroke="#f0a83a" strokeDasharray="5 3" strokeWidth={1.5} label={{ value: 'L1', fill: '#f0a83a', fontSize: 10, position: 'right' }} />}
    {l2 != null && <ReferenceLine y={l2} stroke="#ef4757" strokeDasharray="5 3" strokeWidth={1.5} label={{ value: 'L2', fill: '#ef4757', fontSize: 10, position: 'right' }} />}
  </>;
}

// ─── Y-domain helper ──────────────────────────────────────────────────────────
function yDomain(data, thresholds = {}) {
  if (!data?.length) return ['auto', 'auto'];
  const vals = data.flatMap(d => [d.value, d.min, d.max].filter(v => v != null));
  const refs  = [thresholds.h1, thresholds.h2, thresholds.l1, thresholds.l2].filter(v => v != null);
  const all   = [...vals, ...refs];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.12 || 1;
  return [lo - pad, hi + pad];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════════════
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
  const uid         = useId().replace(/:/g, '');  // stable, collision-free ID
  const gradId      = `${uid}-${sensorId}`;
  const style       = STYLE[measurement] || DEFAULT_STYLE;
  const isAgg       = data.length > 0 && data[0].min != null && data[0].max != null;
  const fmtX        = useMemo(() => makeXFormatter(data), [data]);
  const domain      = useMemo(() => yDomain(data, thresholds), [data, thresholds]);

  // Prepare data (ensure .ts is string-comparable for XAxis dataKey)
  const prepared = useMemo(() =>
    data.map(d => ({ ...d, ts: d.ts instanceof Date ? d.ts.toISOString() : d.ts })),
  [data]);

  const latest = prepared[prepared.length - 1];
  const latestVal = latest ? Number(latest.value).toFixed(2) : '--';
  const alarm = thresholds.h2 != null && latest?.value >= thresholds.h2 ? 'fatal'
              : thresholds.h1 != null && latest?.value >= thresholds.h1 ? 'warning'
              : thresholds.l2 != null && latest?.value <= thresholds.l2 ? 'fatal'
              : thresholds.l1 != null && latest?.value <= thresholds.l1 ? 'warning'
              : 'ok';

  // ─── SVG defs (gradient) ───────────────────────────────────────────────────
  const Defs = () => (
    <defs>
      <linearGradient id={`fill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor={style.color} stopOpacity={0.45} />
        <stop offset="95%" stopColor={style.color} stopOpacity={0.04} />
      </linearGradient>
      {/* Band gradient for min-max range */}
      <linearGradient id={`band-${gradId}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor={style.color} stopOpacity={0.18} />
        <stop offset="95%" stopColor={style.color} stopOpacity={0.04} />
      </linearGradient>
    </defs>
  );

  // ─── Shared chart props ────────────────────────────────────────────────────
  const commonProps = {
    data: prepared,
    margin: { top: 10, right: 28, left: 0, bottom: 0 },
  };
  const xAxisProps = {
    dataKey: 'ts',
    tickFormatter: fmtX,
    tick: AXIS_TICK,
    minTickGap: 40,
  };
  const yAxisProps = {
    domain,
    tick: AXIS_TICK,
    width: 52,
    tickFormatter: v => Number(v).toFixed(1),
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Chart renderers per special type
  // ─────────────────────────────────────────────────────────────────────────

  // Vibration: line with value-coloured dots
  const renderVibration = () => (
    <LineChart {...commonProps}>
      <Defs />
      <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
      <XAxis {...xAxisProps} />
      <YAxis {...yAxisProps} />
      <Tooltip content={<CustomTooltip unit={unit} />} />
      <ThresholdLines thresholds={thresholds} />
      <Line
        type="monotone"
        dataKey="value"
        stroke={style.color}
        strokeWidth={2}
        isAnimationActive={false}
        dot={(props) => (
          <VibrationDot
            key={props.key}
            cx={props.cx}
            cy={props.cy}
            value={props.payload?.value}
            h1={thresholds.h1}
            h2={thresholds.h2}
          />
        )}
        activeDot={{ r: 5, stroke: style.color, fill: '#121a2b' }}
      />
    </LineChart>
  );

  // Level: deep-fill area chart
  const renderLevel = () => (
    <AreaChart {...commonProps}>
      <Defs />
      {/* extra deep fill to convey "how full" */}
      <defs>
        <linearGradient id={`fill-deep-${gradId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={style.color} stopOpacity={0.7} />
          <stop offset="100%" stopColor={style.color} stopOpacity={0.15} />
        </linearGradient>
      </defs>
      <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
      <XAxis {...xAxisProps} />
      <YAxis {...yAxisProps} />
      <Tooltip content={<CustomTooltip unit={unit} />} />
      <ThresholdLines thresholds={thresholds} />
      {isAgg && (
        <Area type="monotone" dataKey="max" stroke="none"
              fill={`url(#band-${gradId})`} dot={false} activeDot={false}
              isAnimationActive={false} legendType="none" />
      )}
      <Area
        type="monotone"
        dataKey="value"
        stroke={style.color}
        strokeWidth={2.5}
        fill={`url(#fill-deep-${gradId})`}
        isAnimationActive={false}
        dot={false}
      />
    </AreaChart>
  );

  // pH: zone bands (danger / warning / optimal / warning / danger)
  const renderPh = () => {
    const phZones = [
      // [y1, y2, color, opacity, label]
      [0,   6.5,  '#ef4757', 0.12, 'Acid'],
      [6.5, 7.5,  '#f0a83a', 0.10, 'Low'],
      [7.5, 8.0,  '#f0a83a', 0.07, ''],
      [8.0, 10.5, '#2cd08c', 0.08, 'Optimal'],
      [10.5,11.0, '#f0a83a', 0.07, ''],
      [11.0,14.0, '#ef4757', 0.12, 'Alkaline'],
    ];
    return (
      <ComposedChart {...commonProps}>
        <Defs />
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
        <XAxis {...xAxisProps} />
        <YAxis {...yAxisProps} />
        <Tooltip content={<CustomTooltip unit={unit} />} />
        {phZones.map(([y1, y2, color, opacity, lbl]) => (
          <ReferenceArea key={`${y1}-${y2}`} y1={y1} y2={y2}
            fill={color} fillOpacity={opacity} stroke="none" />
        ))}
        {isAgg && (
          <Area type="monotone" dataKey="max" stroke="none"
                fill={`url(#band-${gradId})`} dot={false} activeDot={false}
                isAnimationActive={false} legendType="none" />
        )}
        <Area
          type="monotone"
          dataKey="value"
          stroke={style.color}
          strokeWidth={2.5}
          fill={`url(#fill-${gradId})`}
          isAnimationActive={false}
          dot={false}
        />
        {thresholds.h1 != null && <ReferenceLine y={thresholds.h1} stroke="#f0a83a" strokeDasharray="4 3" strokeWidth={1.5} />}
        {thresholds.h2 != null && <ReferenceLine y={thresholds.h2} stroke="#ef4757" strokeDasharray="4 3" strokeWidth={1.5} />}
        {thresholds.l1 != null && <ReferenceLine y={thresholds.l1} stroke="#f0a83a" strokeDasharray="4 3" strokeWidth={1.5} />}
        {thresholds.l2 != null && <ReferenceLine y={thresholds.l2} stroke="#ef4757" strokeDasharray="4 3" strokeWidth={1.5} />}
      </ComposedChart>
    );
  };

  // Generic area chart (fill=true)
  const renderArea = () => (
    <AreaChart {...commonProps}>
      <Defs />
      <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
      <XAxis {...xAxisProps} />
      <YAxis {...yAxisProps} />
      <Tooltip content={<CustomTooltip unit={unit} />} />
      <ThresholdLines thresholds={thresholds} />
      {/* Min-max band for aggregated data */}
      {isAgg && (
        <Area type="monotone" dataKey="max" stroke="none"
              fill={`url(#band-${gradId})`} dot={false} activeDot={false}
              isAnimationActive={false} legendType="none" />
      )}
      {isAgg && (
        <Area type="monotone" dataKey="min" stroke="none"
              fill="#121a2b" dot={false} activeDot={false}
              isAnimationActive={false} legendType="none" />
      )}
      <Area
        type="monotone"
        dataKey="value"
        stroke={style.color}
        strokeWidth={2}
        fill={`url(#fill-${gradId})`}
        isAnimationActive={false}
        dot={false}
        activeDot={{ r: 4, stroke: style.color, fill: '#121a2b' }}
      />
    </AreaChart>
  );

  // Generic line chart (fill=false)
  const renderLine = () => (
    <LineChart {...commonProps}>
      <Defs />
      <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
      <XAxis {...xAxisProps} />
      <YAxis {...yAxisProps} />
      <Tooltip content={<CustomTooltip unit={unit} />} />
      <ThresholdLines thresholds={thresholds} />
      <Line
        type="monotone"
        dataKey="value"
        stroke={style.color}
        strokeWidth={2}
        dot={false}
        isAnimationActive={false}
        activeDot={{ r: 4, stroke: style.color, fill: '#121a2b' }}
      />
    </LineChart>
  );

  // Pick renderer
  const renderChart = () => {
    if (style.special === 'vibration') return renderVibration();
    if (style.special === 'level')     return renderLevel();
    if (style.special === 'ph')        return renderPh();
    if (style.fill)                    return renderArea();
    return renderLine();
  };

  // Alarm colour for the current-value badge
  const alarmColor = alarm === 'fatal' ? '#ef4757'
                   : alarm === 'warning' ? '#f0a83a'
                   : '#2cd08c';

  // ─── Card wrapper ──────────────────────────────────────────────────────────
  return (
    <div className="card" style={{ position: 'relative' }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 13, color: '#cfd8e6' }}>{title}</span>
          {data.length > 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, color: '#7b8799' }}>
              {data.length} points
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Live pulsing dot */}
          {live && (
            <span style={{
              display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
              background: '#2cd08c', boxShadow: '0 0 0 2px rgba(44,208,140,.25)',
            }} />
          )}
          {/* Current value badge */}
          {latest && (
            <span style={{
              background: `${alarmColor}22`,
              color: alarmColor,
              padding: '2px 8px',
              borderRadius: 12,
              fontSize: 12,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {latestVal} {unit}
            </span>
          )}
        </div>
      </div>

      {/* Empty state */}
      {prepared.length === 0 ? (
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a5568', fontSize: 13 }}>
          No data for selected period
        </div>
      ) : (
        <div style={{ width: '100%', height }}>
          <ResponsiveContainer>
            {renderChart()}
          </ResponsiveContainer>
        </div>
      )}

      {/* Aggregated range indicator */}
      {isAgg && (
        <div style={{ marginTop: 4, fontSize: 10, color: '#4a5568', textAlign: 'right' }}>
          Band = min / max per bucket
        </div>
      )}
    </div>
  );
}
