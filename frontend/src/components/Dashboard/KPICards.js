/**
 * KPICards — four stat panels in the Grafana style.
 *
 * Each card shows: title · big number with color coding · optional sub-line
 * + a small inline bar gauge showing saturation/utilisation.
 */
export default function KPICards({ health, alarmStats, mlStatus }) {
  const total   = health?.equipment?.length || 0;
  const running = health?.equipment?.filter(e => e.status === 'running').length || 0;
  const stopped = health?.equipment?.filter(e => e.status === 'stopped').length || 0;
  const faulty  = health?.equipment?.filter(e => e.status === 'fault').length   || 0;

  const avgH = total
    ? (health.equipment.reduce((s, e) => s + (Number(e.health_score) || 0), 0) / total).toFixed(1)
    : '--';

  const alarms = alarmStats?.active || 0;
  const hi = alarmStats?.by_severity?.warning  || alarmStats?.by_severity?.high     || 0;
  const cr = alarmStats?.by_severity?.fatal    || alarmStats?.by_severity?.critical  || 0;

  const mlOk = mlStatus?.ok;

  /* ── helpers ── */
  function healthColor(v) {
    if (v === '--') return 'var(--tm)';
    const n = Number(v);
    if (n >= 80) return 'var(--g)';
    if (n >= 60) return 'var(--yellow)';
    if (n >= 40) return 'var(--orange)';
    return 'var(--red)';
  }

  function alarmColor() {
    if (alarms === 0) return 'var(--g)';
    if (cr > 0)       return 'var(--red)';
    if (hi > 0)       return 'var(--yellow)';
    return 'var(--orange)';
  }

  const onlinePct  = total ? (running / total) * 100 : 0;
  const healthPct  = avgH !== '--' ? Number(avgH) : 0;

  return (
    <div className="kpi-grid">

      {/* Equipment online */}
      <StatCard
        label="Equipment Online"
        value={`${running}`}
        unit={`/ ${total}`}
        sub={`${stopped} stopped · ${faulty} fault`}
        color={running === total && total > 0 ? 'var(--g)' : running > 0 ? 'var(--yellow)' : 'var(--red)'}
        pct={onlinePct}
        barColor={onlinePct > 80 ? 'var(--g)' : onlinePct > 50 ? 'var(--yellow)' : 'var(--red)'}
      />

      {/* Active alarms */}
      <StatCard
        label="Active Alarms"
        value={alarms}
        sub={`${hi} warning · ${cr} critical`}
        color={alarmColor()}
        pct={Math.min(100, (alarms / 10) * 100)}
        barColor={alarmColor()}
        invertBar
      />

      {/* Avg health index */}
      <StatCard
        label="Avg Health Score"
        value={avgH}
        unit="%"
        sub="across all equipment"
        color={healthColor(avgH)}
        pct={healthPct}
        barColor={healthColor(avgH)}
      />

      {/* ML service */}
      <StatCard
        label="ML Service"
        value={mlOk ? 'Online' : 'Offline'}
        sub={mlStatus?.models_loaded ? `${mlStatus.models_loaded} models loaded` : 'No models detected'}
        color={mlOk ? 'var(--g)' : 'var(--red)'}
        pct={mlOk ? 100 : 0}
        barColor={mlOk ? 'var(--g)' : 'var(--red)'}
        mono={false}
      />
    </div>
  );
}

/* ── Single stat card ────────────────────────────────────────── */
function StatCard({ label, value, unit, sub, color, pct = 0, barColor, invertBar = false, mono = true }) {
  return (
    <div className="panel" style={{ minHeight: 100 }}>
      {/* Header */}
      <div className="panel-head">
        <span className="title" style={{ fontSize: 10.5 }}>{label}</span>
        <span className="menu">⋯</span>
      </div>

      {/* Body */}
      <div className="panel-body" style={{ padding: '10px 12px 8px', gap: 6 }}>
        {/* Big number */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span
            className="stat-big"
            style={{
              color,
              fontFamily: mono ? "'JetBrains Mono', monospace" : 'inherit',
              fontSize: typeof value === 'string' && value.length > 6 ? 20 : 28,
            }}
          >
            {value}
          </span>
          {unit && (
            <span style={{ fontSize: 12, color: 'var(--tm)', fontWeight: 500 }}>
              {unit}
            </span>
          )}
        </div>

        {/* Sub-line */}
        {sub && (
          <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>{sub}</div>
        )}

        {/* Mini bar gauge */}
        <div style={{ marginTop: 'auto', paddingTop: 6 }}>
          <div className="bg-track" style={{ height: 4, borderRadius: 2 }}>
            <div
              className="bg-fill"
              style={{
                width: `${invertBar ? 100 - pct : pct}%`,
                background: barColor || color,
                borderRadius: 2,
                transition: 'width .6s ease',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
