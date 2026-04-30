/**
 * TimeRangePicker — compact button-group that selects the active time
 * window for every chart on the page.
 *
 * Single source of truth for: from/to timestamps, recommended Timescale
 * bucket, and live-mode flag. All Dashboard charts use the same range so
 * the selection is visually consistent across panels.
 *
 * `getRangeParams(rangeKey)` is also re-exported and used by
 * EquipmentDetail for the same wiring.
 *
 * Range floor: 15/04/2026 (the official PFE start date). Even when the
 * user picks "All", we never query before that date.
 */

/** Project start date — never query before this. */
export const PROJECT_START = new Date('2026-04-15T00:00:00Z');

export const RANGES = [
  { key: 'live', label: 'Live',  tooltip: 'Last 5 minutes — WebSocket live feed', bucket: 'raw',  windowMs: 5 * 60_000,           live: true  },
  { key: '1h',   label: '1 h',   tooltip: 'Last hour — raw readings',             bucket: 'raw',  windowMs: 3_600_000,             live: false },
  { key: '6h',   label: '6 h',   tooltip: 'Last 6 hours — 1-minute buckets',      bucket: '1m',   windowMs: 6 * 3_600_000,         live: false },
  { key: '24h',  label: '24 h',  tooltip: 'Last 24 hours — 5-minute buckets',     bucket: '5m',   windowMs: 24 * 3_600_000,        live: false },
  { key: '7d',   label: '7 d',   tooltip: 'Last 7 days — 1-hour buckets',         bucket: '1h',   windowMs: 7 * 24 * 3_600_000,    live: false },
  { key: 'all',  label: 'All',   tooltip: 'All available data from 15/04/2026',   bucket: '1h',   windowMs: null,                  live: false },
];

/**
 * Resolve a range key to concrete query params {from, to, bucket}.
 * `from` is clamped so it never falls before the project start.
 */
export function getRangeParams(rangeKey) {
  const def = RANGES.find(r => r.key === rangeKey) || RANGES[RANGES.length - 1];
  const to = new Date();
  const fromMs = def.windowMs == null
    ? PROJECT_START.getTime()
    : Math.max(PROJECT_START.getTime(), to.getTime() - def.windowMs);
  return {
    from:   new Date(fromMs).toISOString(),
    to:     to.toISOString(),
    bucket: def.bucket,
    live:   !!def.live,
    key:    def.key,
    label:  def.label,
  };
}

/**
 * Filter an array of {ts, value} points down to the selected window.
 * Used client-side to trim the live ring buffer + seeded history so
 * charts never show points outside the selected period.
 */
export function filterPointsToRange(points = [], rangeKey) {
  if (!points.length) return points;
  const def = RANGES.find(r => r.key === rangeKey) || RANGES[RANGES.length - 1];
  const now = Date.now();
  const fromMs = def.windowMs == null
    ? PROJECT_START.getTime()
    : Math.max(PROJECT_START.getTime(), now - def.windowMs);
  return points.filter(p => {
    const ts = typeof p.ts === 'number' ? p.ts : new Date(p.ts).getTime();
    return ts >= fromMs;
  });
}

export default function TimeRangePicker({ value, onChange, disabled = false }) {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10.5, color: 'var(--tm)', marginRight: 4 }}>Period:</span>
      {RANGES.map(r => {
        const active = value === r.key;
        const isLive = r.key === 'live';
        return (
          <button
            key={r.key}
            title={r.tooltip}
            disabled={disabled}
            onClick={() => onChange(r.key)}
            style={{
              padding: '3px 9px',
              borderRadius: 4,
              fontSize: 11.5,
              fontWeight: active ? 700 : 400,
              border: active ? '1px solid var(--g)' : '1px solid var(--border)',
              background: active ? 'var(--g-soft)' : 'transparent',
              color: active ? 'var(--g)' : isLive ? 'var(--g)' : 'var(--tm)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'all .12s',
              fontFamily: 'inherit',
              opacity: disabled ? .5 : 1,
            }}
          >
            {isLive ? <><span style={{ fontSize: 7 }}>⬤</span> {r.label}</> : r.label}
          </button>
        );
      })}
    </div>
  );
}
