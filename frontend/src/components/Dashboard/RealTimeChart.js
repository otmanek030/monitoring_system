/**
 * Recharts line chart fed by a ring buffer of live readings.
 *
 * Props:
 *   title       - display name (e.g. "VP-230A · Vibration")
 *   unit        - engineering unit label
 *   data        - [{ ts, value }]
 *   yDomain     - optional [min, max]
 *   color       - line colour
 *   thresholds  - optional { h1, h2, l1, l2 } shown as ReferenceLines
 */
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts';

const fmtTime = (ts) => {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false });
};

export default function RealTimeChart({
  title, unit, data = [], yDomain, color = '#4da3ff', thresholds = {},
}) {
  const prepared = data.map(d => ({ ...d, t: fmtTime(d.ts) }));
  return (
    <div className="card">
      <div className="card-head">
        <strong>{title}</strong>
        <span className="muted" style={{ fontSize: 12 }}>{unit}</span>
      </div>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={prepared} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#1c2538" strokeDasharray="3 3" />
            <XAxis dataKey="t" tick={{ fill: '#7b8799', fontSize: 11 }} minTickGap={20} />
            <YAxis domain={yDomain || ['auto', 'auto']}
                   tick={{ fill: '#7b8799', fontSize: 11 }} width={50} />
            <Tooltip contentStyle={{ background: '#121a2b', border: '1px solid #25314a' }}
                     labelStyle={{ color: '#cfd8e6' }} />
            {thresholds.h2 != null && <ReferenceLine y={thresholds.h2} stroke="#ff5566" strokeDasharray="4 4" />}
            {thresholds.h1 != null && <ReferenceLine y={thresholds.h1} stroke="#ffb04a" strokeDasharray="4 4" />}
            {thresholds.l1 != null && <ReferenceLine y={thresholds.l1} stroke="#ffb04a" strokeDasharray="4 4" />}
            {thresholds.l2 != null && <ReferenceLine y={thresholds.l2} stroke="#ff5566" strokeDasharray="4 4" />}
            <Line type="monotone" dataKey="value" stroke={color}
                  strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
