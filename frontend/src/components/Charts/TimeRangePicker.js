/**
 * TimeRangePicker — compact button-group for selecting a chart time window.
 *
 * Each range also carries the API bucket size and a `from` factory so callers
 * don't have to re-implement this logic.
 *
 * Usage:
 *   const [range, setRange] = useState('all');
 *   <TimeRangePicker value={range} onChange={setRange} />
 *
 *   // Get API params for the current range:
 *   const { from, bucket } = getRangeParams(range);
 *   await Sensors.readings(id, { from, bucket, limit: 5000 });
 */

// ─── Range definitions ────────────────────────────────────────────────────────
export const RANGES = [
  {
    key: 'live',
    label: 'Live',
    tooltip: 'Last 5 minutes — WebSocket live feed',
    bucket: 'raw',
    fromMs: () => Date.now() - 5 * 60 * 1000,
  },
  {
    key: '1h',
    label: '1 h',
    tooltip: 'Last hour — raw readings',
    bucket: 'raw',
    fromMs: () => Date.now() - 3_600_000,
  },
  {
    key: '6h',
    label: '6 h',
    tooltip: 'Last 6 hours — 1-minute buckets',
    bucket: '1m',
    fromMs: () => Date.now() - 6 * 3_600_000,
  },
  {
    key: '24h',
    label: '24 h',
    tooltip: 'Last 24 hours — 5-minute buckets',
    bucket: '5m',
    fromMs: () => Date.now() - 24 * 3_600_000,
  },
  {
    key: '7d',
    label: '7 d',
    tooltip: 'Last 7 days — 1-hour buckets',
    bucket: '1h',
    fromMs: () => Date.now() - 7 * 24 * 3_600_000,
  },
  {
    key: 'all',
    label: 'All',
    tooltip: 'All available data from project start — 1-hour buckets',
    bucket: '1h',
    // Project started April 15 2026
    fromMs: () => new Date('2026-04-15T00:00:00Z').getTime(),
  },
];

/**
 * Returns { from: ISO string, bucket: string } for a given range key.
 * Pass these directly to Sensors.readings().
 */
export function getRangeParams(rangeKey) {
  const def = RANGES.find(r => r.key === rangeKey) || RANGES[RANGES.length - 1];
  return {
    from:   new Date(def.fromMs()).toISOString(),
    bucket: def.bucket,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function TimeRangePicker({ value, onChange, disabled = false }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: '#7b8799', marginRight: 4 }}>Period:</span>
      {RANGES.map(r => (
        <button
          key={r.key}
          title={r.tooltip}
          disabled={disabled}
          onClick={() => onChange(r.key)}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: value === r.key ? 700 : 400,
            border: value === r.key ? '1px solid #4da3ff' : '1px solid #1f2b4d',
            background: value === r.key ? 'rgba(77,163,255,.18)' : 'transparent',
            color: value === r.key ? '#4da3ff'
                 : r.key === 'live' ? '#2cd08c'
                 : '#8aa0c6',
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'all .15s',
          }}
        >
          {r.key === 'live' ? '⬤ ' + r.label : r.label}
        </button>
      ))}
    </div>
  );
}
