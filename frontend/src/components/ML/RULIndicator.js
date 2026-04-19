/**
 * RULIndicator — OCP light-theme Remaining Useful Life gauge.
 *
 * Expects: { rul_hours, health_index, confidence, recommendation, ... }
 *
 * Health-index: if value ≤ 1, auto-scaled ×100 to get percentage.
 */
export default function RULIndicator({ rul }) {
  if (!rul) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span className="title">Remaining Useful Life</span>
          <span className="menu">⋯</span>
        </div>
        <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--tm)', fontSize: 12.5 }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>⏱</div>
          No RUL data — select an equipment to load
        </div>
      </div>
    );
  }

  const hours    = Math.max(0, Number(rul.rul_hours) || 0);
  const hiRaw    = Number(rul.health_index) || 0;
  const hi       = Math.max(0, Math.min(100, hiRaw <= 1 ? hiRaw * 100 : hiRaw));
  const hiColor  = hi >= 70 ? 'var(--g)'     : hi >= 40 ? 'var(--orange)' : 'var(--red)';
  const hiBar    = hi >= 70 ? 'var(--g)'     : hi >= 40 ? 'var(--orange)' : 'var(--red)';
  const lifetime = formatLifetime(hours);

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">Remaining Useful Life</span>
        <span style={{ fontSize: 10.5, color: 'var(--tm)', marginLeft: 4 }}>
          confidence {Math.round((Number(rul.confidence) || 0) * 100)}%
        </span>
        <span className="menu">⋯</span>
      </div>

      <div className="panel-body" style={{ gap: 14 }}>
        {/* Gauge + lifetime */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <LightGauge value={hi} color={hiBar} label="Health" />
          <div>
            <div style={{
              fontSize: 10.5, color: 'var(--tm)', marginBottom: 4,
              textTransform: 'uppercase', letterSpacing: .3, fontWeight: 700,
            }}>
              Estimated Lifetime
            </div>
            <div style={{
              fontSize: 28, fontWeight: 700, color: hiColor,
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: -1, lineHeight: 1.1,
            }}>
              {lifetime.primary}
            </div>
            <div style={{
              fontSize: 11, color: 'var(--td)', marginTop: 3,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {lifetime.secondary}
            </div>
          </div>
        </div>

        {/* Health bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{
              fontSize: 10.5, color: 'var(--tm)',
              textTransform: 'uppercase', letterSpacing: .3, fontWeight: 700,
            }}>
              Health Index
            </span>
            <span style={{
              fontSize: 11.5, color: hiColor,
              fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
            }}>
              {hi.toFixed(1)}%
            </span>
          </div>
          <div style={{ height: 7, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: `${hi}%`, height: '100%',
              background: hiBar, borderRadius: 3,
              transition: 'width .6s ease',
            }} />
          </div>
        </div>

        {/* Recommendation */}
        {rul.recommendation && (
          <div style={{
            padding: '9px 12px',
            background: 'var(--g-softer)',
            borderRadius: 5,
            borderLeft: '3px solid var(--g)',
            fontSize: 12,
            color: 'var(--tx)',
          }}>
            <div style={{
              fontSize: 10, color: 'var(--tm)', marginBottom: 3,
              textTransform: 'uppercase', letterSpacing: .3, fontWeight: 700,
            }}>
              Recommendation
            </div>
            {rul.recommendation}
          </div>
        )}
      </div>
    </div>
  );
}

function formatLifetime(hours) {
  if (hours < 1)  return { primary: '< 1 hour', secondary: '≈ 0 days' };
  if (hours < 24) return { primary: `${hours.toFixed(1)}h`, secondary: `≈ ${(hours / 24).toFixed(2)} days` };

  const days   = hours / 24;
  const months = days / 30.44;
  const years  = days / 365.25;

  if (days < 14)   return { primary: `${days.toFixed(1)}d`,       secondary: `≈ ${Math.round(hours)} h` };
  if (months < 12) return { primary: `${months.toFixed(1)} mo`,   secondary: `≈ ${Math.round(days)} days` };
  if (years < 5)   return { primary: `${years.toFixed(1)} yr`,    secondary: `≈ ${Math.round(days).toLocaleString()} days` };
  return { primary: '> 5 yr', secondary: `model est: ${Math.round(days).toLocaleString()} days` };
}

/** OCP light-theme donut gauge SVG */
function LightGauge({ value, color, label }) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = 38, c = 2 * Math.PI * r;
  const dash = (clamped / 100) * c;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96">
      {/* Track — light green tint */}
      <circle cx="48" cy="48" r={r} stroke="var(--border)" strokeWidth="9" fill="none" />
      {/* Fill */}
      <circle cx="48" cy="48" r={r} stroke={color} strokeWidth="9" fill="none"
        strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
        transform="rotate(-90 48 48)" />
      {/* Value */}
      <text x="48" y="45" textAnchor="middle" fill="var(--tx)" fontSize="18" fontWeight="700"
        fontFamily="'JetBrains Mono', sans-serif">
        {Math.round(clamped)}
      </text>
      <text x="48" y="62" textAnchor="middle" fill="var(--tm)" fontSize="9.5"
        fontFamily="'Inter', sans-serif">
        {label}
      </text>
    </svg>
  );
}
