/**
 * RealTimeChart — dark-themed Recharts line chart.
 *
 * Props:
 *   title       - display name
 *   unit        - engineering unit label
 *   data        - [{ ts, value }]
 *   yDomain     - optional [min, max]
 *   color       - line colour (defaults to fern green)
 *   thresholds  - { h1, h2, l1, l2 } reference lines
 */
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Area, AreaChart,
} from 'recharts';

const fmtTime = (ts) => {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' });
};

const CustomTooltip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#fff',
      border: '1px solid var(--g-soft)',
      borderRadius: 5,
      padding: '6px 10px',
      fontSize: 11.5,
      color: 'var(--tx)',
      boxShadow: '0 2px 8px rgba(0,0,0,.08)',
    }}>
      <div style={{ color: 'var(--tm)', marginBottom: 3 }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color, fontFamily: "'JetBrains Mono', monospace" }}>
          {p.value?.toFixed(2)} {unit}
        </div>
      ))}
    </div>
  );
};

export default function RealTimeChart({
  title, unit, data = [], yDomain, color = '#52b788', thresholds = {},
}) {
  const prepared = data.map(d => ({ ...d, t: fmtTime(d.ts) }));

  // Latest value for header
  const latest = prepared[prepared.length - 1]?.value;

  return (
    <div className="panel">
      {/* Panel header */}
      <div className="panel-head">
        <span className="title">{title}</span>
        {latest != null && (
          <span style={{
            marginLeft: 6,
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--g)',
            fontWeight: 700,
          }}>
            {Number(latest).toFixed(2)} <span style={{ color: 'var(--tm)', fontWeight: 400 }}>{unit}</span>
          </span>
        )}
        <span className="menu">⋯</span>
      </div>

      {/* Chart */}
      <div style={{ flex: 1, minHeight: 180, padding: '8px 4px 0' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={prepared} margin={{ top: 4, right: 12, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={color} stopOpacity={0}   />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />

            <XAxis
              dataKey="t"
              tick={{ fill: 'var(--tm)', fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              minTickGap={40}
            />
            <YAxis
              domain={yDomain || ['auto', 'auto']}
              tick={{ fill: 'var(--tm)', fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}
              tickLine={false}
              axisLine={false}
              width={46}
            />

            <Tooltip content={<CustomTooltip unit={unit} />} />

            {/* Threshold reference lines */}
            {thresholds.h2 != null && (
              <ReferenceLine y={thresholds.h2} stroke="var(--red)"    strokeDasharray="4 3" strokeWidth={1} />
            )}
            {thresholds.h1 != null && (
              <ReferenceLine y={thresholds.h1} stroke="var(--yellow)" strokeDasharray="4 3" strokeWidth={1} />
            )}
            {thresholds.l1 != null && (
              <ReferenceLine y={thresholds.l1} stroke="var(--yellow)" strokeDasharray="4 3" strokeWidth={1} />
            )}
            {thresholds.l2 != null && (
              <ReferenceLine y={thresholds.l2} stroke="var(--red)"    strokeDasharray="4 3" strokeWidth={1} />
            )}

            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={1.8}
              fill={`url(#grad-${title})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
