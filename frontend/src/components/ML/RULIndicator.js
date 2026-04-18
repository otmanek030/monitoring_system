/**
 * Remaining Useful Life gauge.
 *
 * Expects { rul_hours, health_index, confidence, ... } from the backend.
 * - rul_hours is clamped to [0, 8760] (1 year) for visual purposes.
 * - health_index is [0, 100].
 */
export default function RULIndicator({ rul }) {
  if (!rul) {
    return (
      <div className="card">
        <div className="card-head"><strong>Remaining Useful Life</strong></div>
        <div className="muted" style={{ padding: 12 }}>No RUL data yet.</div>
      </div>
    );
  }
  const days    = Math.round((Number(rul.rul_hours) || 0) / 24 * 10) / 10;
  const hi      = Math.max(0, Math.min(100, Number(rul.health_index) || 0));
  const hiColor = hi >= 70 ? '#2cd08c' : hi >= 40 ? '#ffb04a' : '#ff5566';

  return (
    <div className="card">
      <div className="card-head">
        <strong>Remaining Useful Life</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          confidence {Math.round((Number(rul.confidence) || 0) * 100)}%
        </span>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginTop: 6 }}>
        <Gauge value={hi} label="Health" color={hiColor} />
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Estimated lifetime</div>
          <div style={{ fontSize: 28, fontWeight: 600, color: hiColor }}>
            {days.toLocaleString()} days
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            ≈ {Math.round(Number(rul.rul_hours) || 0)} h
          </div>
        </div>
      </div>

      {rul.recommendation && (
        <div style={{ marginTop: 12, padding: 10,
                      background: 'rgba(77,163,255,0.08)', borderRadius: 8,
                      borderLeft: '3px solid #4da3ff' }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Recommendation</div>
          <div>{rul.recommendation}</div>
        </div>
      )}
    </div>
  );
}

/** Tiny donut gauge using two overlapping semi-circles. */
function Gauge({ value, color, label }) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = 42, c = 2 * Math.PI * r;
  const dash = (clamped / 100) * c;
  return (
    <svg width="110" height="110" viewBox="0 0 110 110">
      <circle cx="55" cy="55" r={r} stroke="#25314a" strokeWidth="10" fill="none" />
      <circle cx="55" cy="55" r={r} stroke={color} strokeWidth="10" fill="none"
              strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
              transform="rotate(-90 55 55)" />
      <text x="55" y="52" textAnchor="middle" fill="#e8eefc" fontSize="20" fontWeight="600">
        {Math.round(clamped)}
      </text>
      <text x="55" y="70" textAnchor="middle" fill="#7b8799" fontSize="10">
        {label}
      </text>
    </svg>
  );
}
