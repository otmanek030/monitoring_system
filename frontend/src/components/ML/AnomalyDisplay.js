/**
 * AnomalyDisplay — OCP light-theme visualisation of anomaly-detection result.
 *
 * Expects: { is_anomaly, score, confidence, window_minutes, features, created_at }
 */
export default function AnomalyDisplay({ result }) {
  if (!result) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span className="title">Anomaly Detection</span>
          <span className="menu">⋯</span>
        </div>
        <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--tm)', fontSize: 12.5 }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>🔍</div>
          Select a sensor and run a prediction
        </div>
      </div>
    );
  }

  const score    = Math.max(0, Math.min(1, Number(result.score) || 0));
  const pct      = Math.round(score * 100);
  const color    = score > 0.7 ? 'var(--red)' : score > 0.4 ? 'var(--orange)' : 'var(--g)';
  const barColor = score > 0.7 ? 'var(--red)' : score > 0.4 ? 'var(--orange)' : 'var(--g)';
  /* Subtle tint on the panel background */
  const bgColor  = score > 0.7
    ? 'rgba(214,69,69,.04)'
    : score > 0.4
      ? 'rgba(232,138,58,.04)'
      : 'var(--g-softer)';

  return (
    <div className="panel" style={{ background: bgColor }}>
      <div className="panel-head">
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: result.is_anomaly ? 'var(--red)' : 'var(--g)',
          boxShadow: result.is_anomaly ? '0 0 6px rgba(214,69,69,.5)' : '0 0 4px rgba(0,122,61,.4)',
        }} />
        <span className="title">Anomaly Detection</span>
        {result.window_minutes && (
          <span style={{ fontSize: 10.5, color: 'var(--tm)', marginLeft: 4 }}>
            window {result.window_minutes} min
          </span>
        )}
        <span className="menu">⋯</span>
      </div>

      <div className="panel-body" style={{ gap: 12 }}>
        {/* Result headline */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{
            fontSize: 28, fontWeight: 700, color,
            letterSpacing: -0.5,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {result.is_anomaly ? 'ANOMALY' : 'Normal'}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
            confidence {Math.round((Number(result.confidence) || 0) * 100)}%
          </span>
        </div>

        {/* Score bar */}
        <div>
          <div style={{
            height: 8, background: 'var(--border)',
            borderRadius: 4, overflow: 'hidden',
          }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              background: barColor, borderRadius: 4,
              transition: 'width .5s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 10.5, color: 'var(--tm)', fontFamily: "'JetBrains Mono', monospace" }}>
              Score: {score.toFixed(3)}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--td)' }}>0 = normal · 1 = anomalous</span>
          </div>
        </div>

        {/* Feature vector (expandable) */}
        {result.features && (
          <details style={{ marginTop: 4 }}>
            <summary style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--tm)', userSelect: 'none' }}>
              Feature vector ▸
            </summary>
            <pre style={{
              marginTop: 6, maxHeight: 120, overflow: 'auto',
              background: 'var(--g-softer)', border: '1px solid var(--border)',
              borderRadius: 5, padding: '8px 10px',
              fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--tx)', lineHeight: 1.5,
            }}>
              {JSON.stringify(result.features, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
