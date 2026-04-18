/**
 * Four small cards summarising the plant state:
 *   - Equipment online / total
 *   - Active alarms (broken down H/L)
 *   - Average health index
 *   - ML service status
 */
export default function KPICards({ health, alarmStats, mlStatus }) {
  const total    = health?.equipment?.length || 0;
  const running  = health?.equipment?.filter(e => e.status === 'running').length || 0;
  const avgH     = total
    ? (health.equipment.reduce((s, e) => s + (Number(e.health_score) || 0), 0) / total).toFixed(1)
    : '--';

  const alarms = alarmStats?.active || 0;
  // The DB stores severity as 'warning' (H1) and 'fatal' (H2).
  // Accept both the DB names and older camelCase aliases defensively.
  const hi = alarmStats?.by_severity?.warning  || alarmStats?.by_severity?.high     || 0;
  const cr = alarmStats?.by_severity?.fatal    || alarmStats?.by_severity?.critical  || 0;

  const mlOk = mlStatus?.ok;

  return (
    <div className="kpi-grid">
      <Card label="Equipment online" value={`${running} / ${total}`} tint="#2cd08c" />
      <Card label="Active alarms"    value={alarms}
            tint={alarms === 0 ? '#2cd08c' : cr > 0 ? '#ff5566' : '#ffb04a'}
            sub={`${hi} high · ${cr} critical`} />
      <Card label="Avg health index" value={avgH}
            tint={avgH === '--' ? '#888' : avgH >= 70 ? '#2cd08c' : avgH >= 40 ? '#ffb04a' : '#ff5566'} />
      <Card label="ML service"       value={mlOk ? 'Online' : 'Offline'}
            tint={mlOk ? '#2cd08c' : '#ff5566'}
            sub={mlStatus?.models_loaded ? `${mlStatus.models_loaded} models loaded` : ''} />
    </div>
  );
}

function Card({ label, value, sub, tint = '#4da3ff' }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: tint }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  );
}
