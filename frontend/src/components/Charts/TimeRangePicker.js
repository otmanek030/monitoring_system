/**
 * TimeRangePicker — compact dark-themed button-group for chart time windows.
 */

export const RANGES = [
  { key: 'live', label: 'Live',  tooltip: 'Last 5 minutes — WebSocket live feed',         bucket: 'raw', fromMs: () => Date.now() - 5 * 60 * 1000 },
  { key: '1h',   label: '1 h',   tooltip: 'Last hour — raw readings',                     bucket: 'raw', fromMs: () => Date.now() - 3_600_000 },
  { key: '6h',   label: '6 h',   tooltip: 'Last 6 hours — 1-minute buckets',              bucket: '1m',  fromMs: () => Date.now() - 6 * 3_600_000 },
  { key: '24h',  label: '24 h',  tooltip: 'Last 24 hours — 5-minute buckets',             bucket: '5m',  fromMs: () => Date.now() - 24 * 3_600_000 },
  { key: '7d',   label: '7 d',   tooltip: 'Last 7 days — 1-hour buckets',                 bucket: '1h',  fromMs: () => Date.now() - 7 * 24 * 3_600_000 },
  { key: 'all',  label: 'All',   tooltip: 'All available data from project start',         bucket: '1h',  fromMs: () => new Date('2026-04-15T00:00:00Z').getTime() },
];

export function getRangeParams(rangeKey) {
  const def = RANGES.find(r => r.key === rangeKey) || RANGES[RANGES.length - 1];
  return { from: new Date(def.fromMs()).toISOString(), bucket: def.bucket };
}

export default function TimeRangePicker({ value, onChange, disabled = false }) {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
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
