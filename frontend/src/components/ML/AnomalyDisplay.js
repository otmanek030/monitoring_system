/**
 * Visualisation of an anomaly-detection response.
 *
 * Expects the shape returned by POST /api/predictions/anomaly:
 *   { is_anomaly, score, confidence, window_minutes, features, created_at }
 *
 * The score is clamped to [0,1] and shown as a coloured progress bar.
 */
export default function AnomalyDisplay({ result }) {
  if (!result) {
    return (
      <div className="card">
        <div className="card-head"><strong>Anomaly detection</strong></div>
        <div className="muted" style={{ padding: 12 }}>Select a sensor and run a prediction.</div>
      </div>
    );
  }
  const score = Math.max(0, Math.min(1, Number(result.score) || 0));
  const pct   = Math.round(score * 100);
  const color = score > 0.7 ? '#ff5566' : score > 0.4 ? '#ffb04a' : '#2cd08c';

  return (
    <div className="card">
      <div className="card-head">
        <strong>Anomaly detection</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          {result.window_minutes ? `window: ${result.window_minutes} min` : ''}
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 28, fontWeight: 600, color }}>
          {result.is_anomaly ? 'ANOMALY' : 'Normal'}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          confidence {Math.round((Number(result.confidence) || 0) * 100)}%
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="meter">
          <div className="meter-fill" style={{ width: `${pct}%`, background: color }} />
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Score: {score.toFixed(3)} (0 = normal · 1 = highly anomalous)
        </div>
      </div>

      {result.features && (
        <details style={{ marginTop: 12 }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>Feature vector</summary>
          <pre className="code">{JSON.stringify(result.features, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
