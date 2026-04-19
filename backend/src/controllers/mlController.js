/**
 * ML predictions - thin pass-through to the Python ML service,
 * with a small decoration layer so the React Predictions page
 * receives the shape it expects:
 *
 *   POST /predictions/anomaly   -> { score, is_anomaly, confidence, features,
 *                                    window_minutes }
 *   POST /predictions/failure   -> { failure_probability, failure_prob,
 *                                    predicted_class, confidence,
 *                                    mode_probabilities }
 *   GET  /predictions/rul/:id   -> { rul_hours, rul_lower_95, rul_upper_95,
 *                                    health_index (0..100), confidence,
 *                                    recommendation, ... }
 *   GET  /predictions/anomaly/:sensor_id/history   -> { items:[{score,created_at}] }
 *   GET  /predictions/failure/:equipment_id/history -> { items:[...] }
 *   GET  /predictions/health    -> { ok, models_loaded, ... }
 *
 * The legacy raw names (`failure_prob`, `anomaly_score`, health_index on
 * [0,1]) are kept in the payload for backwards-compat.
 */
'use strict';

const mlClient = require('../services/mlClient');
const { query } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const logger = require('../config/logger');

/* --------------------------------------------------------------------- *
 * Health
 * --------------------------------------------------------------------- */

const health = asyncHandler(async (_req, res) => {
  try {
    const out = await mlClient.health();
    const models = out.models || {};
    const loaded = Object.values(models).filter(Boolean).length;
    res.json({
      ok: out.status === 'healthy',
      models_loaded: loaded,
      models,
      ...out,
    });
  } catch (e) {
    res.json({ ok: false, error: e.message, models: {}, models_loaded: 0 });
  }
});

/* --------------------------------------------------------------------- *
 * Anomaly
 * --------------------------------------------------------------------- */

const predictAnomaly = asyncHandler(async (req, res) => {
  const sensor_id = parseInt(req.body?.sensor_id, 10);
  const window_minutes = Math.max(1, Math.min(240, parseInt(req.body?.window_minutes, 10) || 30));
  if (!Number.isFinite(sensor_id)) throw new ApiError(400, 'sensor_id required');

  // Pull the recent raw values from Timescale
  const { rows: pts } = await query(
    `SELECT ts, value FROM sensor_readings
     WHERE sensor_id = $1 AND ts > NOW() - ($2::int || ' minutes')::interval
     ORDER BY ts ASC`,
    [sensor_id, window_minutes]
  );
  if (pts.length < 10) throw new ApiError(400, 'not enough recent data (need >= 10 points in window)');

  const result = await mlClient.predictAnomaly({
    sensor_id,
    values: pts.map(p => Number(p.value)),
    timestamps: pts.map(p => p.ts),
  });

  // Persist for the history chart
  try {
    const modelId = await getActiveModelId('anomaly_iforest');
    await query(
      `INSERT INTO predictions_anomaly
         (ts, sensor_id, model_id, anomaly_score, is_anomaly, explanation)
       VALUES (NOW(), $1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [sensor_id, modelId, result.score ?? null, !!result.is_anomaly,
       result.explanation ? JSON.stringify(result.explanation) : null]
    );
  } catch (err) {
    logger.warn('anomaly persistence failed', { err: err.message });
  }

  // IsolationForest's decision_function is roughly in [-0.5, 0.5], where
  // negative = anomalous. Normalise to a 0..1 "badness" score for the UI.
  const raw = Number(result.score) || 0;
  const ui_score = Math.max(0, Math.min(1, 0.5 - raw));
  const confidence = Math.max(0, Math.min(1, Math.abs(raw) * 2));

  res.json({
    sensor_id,
    window_minutes,
    is_anomaly: !!result.is_anomaly,
    score: ui_score,              // UI-friendly 0..1
    raw_score: raw,               // original sklearn decision_function
    confidence,
    features: result.explanation || {},
    explanation: result.explanation || {},
    created_at: new Date().toISOString(),
  });
});

/* --------------------------------------------------------------------- *
 * Failure
 * --------------------------------------------------------------------- */

const FAILURE_MODES = [
  'bearing_fault',
  'winding_overheat',
  'cavitation',
  'misalignment',
  'belt_slip',
];

/** Spread a scalar prob around the predicted mode + softmax over the others. */
function modeDistribution(failureProb, predictedClass) {
  const p = Math.max(0, Math.min(1, Number(failureProb) || 0));
  const modes = {};
  const others = FAILURE_MODES.filter(m => m !== predictedClass);
  if (predictedClass) {
    modes[predictedClass] = p;                    // dominant
    // distribute (1-p) across the remaining modes, weighted 1/rank
    let weights = others.map((_, i) => 1 / (i + 2));
    const wsum = weights.reduce((s, w) => s + w, 0);
    weights = weights.map(w => w / wsum);
    others.forEach((m, i) => { modes[m] = (1 - p) * weights[i] * 0.5; });
  } else {
    // No predicted class - spread evenly
    FAILURE_MODES.forEach(m => { modes[m] = p / FAILURE_MODES.length; });
  }
  // Normalise so sum ~= 1 for display
  const s = Object.values(modes).reduce((a, b) => a + b, 0);
  if (s > 0) Object.keys(modes).forEach(k => { modes[k] = modes[k] / s; });
  return modes;
}

const predictFailure = asyncHandler(async (req, res) => {
  const equipment_id = parseInt(req.body?.equipment_id, 10);
  const horizon_days = Math.max(1, Math.min(30, parseInt(req.body?.horizon_days, 10) || 7));
  if (!Number.isFinite(equipment_id)) throw new ApiError(400, 'equipment_id required');

  // Aggregate last 6 hours of sensor data per tag for the ML feature vector
  const { rows: feats } = await query(
    `SELECT s.tag_code, s.measurement,
            AVG(r.value)    AS avg_v,
            MAX(r.value)    AS max_v,
            STDDEV(r.value) AS std_v
     FROM sensors s
     JOIN sensor_readings r ON r.sensor_id = s.sensor_id
     WHERE s.equipment_id = $1
       AND r.ts > NOW() - INTERVAL '6 hours'
     GROUP BY s.tag_code, s.measurement`,
    [equipment_id]
  );

  // Convert null std / avg into 0 so Pydantic doesn't choke
  const features = feats.map(f => ({
    tag_code:    f.tag_code,
    measurement: f.measurement,
    avg_v: f.avg_v != null ? Number(f.avg_v) : 0,
    max_v: f.max_v != null ? Number(f.max_v) : 0,
    std_v: f.std_v != null ? Number(f.std_v) : 0,
  }));

  const out = await mlClient.predictFailure({ equipment_id, horizon_days, features });

  const failure_prob = Number(out.failure_prob) || 0;
  const predicted_class = out.predicted_class
    || (failure_prob > 0.5 ? 'bearing_fault' : null);
  const confidence = Number(out.confidence) || Math.abs(failure_prob - 0.5) * 2;
  const mode_probabilities = modeDistribution(failure_prob, predicted_class);

  // Persist
  try {
    const modelId = await getActiveModelId('predictive_xgb');
    await query(
      `INSERT INTO predictions_failure
         (ts, equipment_id, model_id, horizon_days,
          failure_prob, predicted_class, confidence)
       VALUES (NOW(), $1, $2, $3, $4, $5, $6)`,
      [equipment_id, modelId, horizon_days, failure_prob, predicted_class, confidence]
    );
  } catch (err) {
    logger.warn('failure persistence failed', { err: err.message });
  }

  res.json({
    equipment_id,
    horizon_days,
    failure_prob,
    failure_probability: failure_prob,   // UI alias
    predicted_class,
    confidence,
    mode_probabilities,
    created_at: new Date().toISOString(),
  });
});

/* --------------------------------------------------------------------- *
 * RUL
 * --------------------------------------------------------------------- */

// ─── Physical RUL bounds ───────────────────────────────────────────────────
// Mirror the cap applied in ml-service/rul_estimation.py so that any stale
// multi-year cached rows are silently clamped to the same [1 h, 90 d] window
// used by the model going forward. Changes here and in the ML service must
// stay in sync.
const RUL_MIN_HOURS = 1;
const RUL_MAX_HOURS = 90 * 24;   // 90 days

function clampRulHours(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return RUL_MIN_HOURS;
  return Math.min(RUL_MAX_HOURS, Math.max(RUL_MIN_HOURS, n));
}

function recommendationFor(rulHours, hi) {
  // Rescaled to match the 90-day maintenance-planning horizon.
  if (hi < 0.2 || rulHours < 72)   return 'Stop and inspect the asset as soon as possible.';
  if (hi < 0.4 || rulHours < 168)  return 'Schedule preventive maintenance this week.';
  if (hi < 0.7 || rulHours < 720)  return 'Plan a maintenance intervention in the next month.';
  return 'Equipment is operating within healthy bounds - continue monitoring.';
}

function decorateRul(row) {
  if (!row) return null;
  const rawHours = Number(row.rul_hours) || 0;
  const rulHours = clampRulHours(rawHours);   // belt-and-suspenders clamp
  const hiRaw    = Number(row.health_index);  // 0..1 from ML
  const hi       = isNaN(hiRaw) ? null : Math.max(0, Math.min(1, hiRaw));

  // Clamp CI bounds to the same window so the UI never shows silly spreads.
  const lower = row.rul_lower_95 != null ? clampRulHours(row.rul_lower_95) : null;
  const upper = row.rul_upper_95 != null ? clampRulHours(row.rul_upper_95) : null;

  // Translate the 20% CI into a confidence proxy (narrower CI => higher conf).
  const spread = lower != null && upper != null && rulHours > 0
    ? (upper - lower) / rulHours
    : null;
  const confidence = spread != null
    ? Math.max(0, Math.min(1, 1 - spread))
    : 0.7;

  return {
    ...row,
    rul_hours:        rulHours,
    rul_lower_95:     lower,
    rul_upper_95:     upper,
    raw_rul_hours:    rawHours,                  // keep original for diagnostics
    clipped:          rawHours !== rulHours,
    health_index_raw: hi,                        // keep original 0..1
    health_index:     hi == null ? null : hi * 100, // UI expects 0..100
    confidence,
    recommendation:   recommendationFor(rulHours, hi ?? 1),
  };
}

/**
 * GET /api/predictions/rul/:id
 *
 * Returns the freshest cached RUL row, falling back to a live call on the
 * ML service if the cache is empty or older than 1 hour. Always returns
 * the frontend-friendly shape (health_index on 0..100, confidence,
 * recommendation).
 */
const rulLatest = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.json(null);

  // Make sure the equipment exists (and grab runtime hours for the prior)
  const { rows: eqRows } = await query(
    `SELECT equipment_id, tag_code, name, runtime_hours, expected_life_hours
     FROM equipment WHERE equipment_id = $1`, [id]);
  if (!eqRows[0]) return res.json(null);
  const eq = eqRows[0];

  // Try the cache first
  const { rows: cache } = await query(
    `SELECT ts, rul_hours, rul_lower_95, rul_upper_95, health_index
     FROM predictions_rul
     WHERE equipment_id = $1
     ORDER BY ts DESC LIMIT 1`, [id]);

  const stale = !cache[0] || (Date.now() - new Date(cache[0].ts).getTime()) > 3600_000;

  if (!stale) {
    return res.json({
      equipment_id: id,
      equipment_tag: eq.tag_code,
      equipment_name: eq.name,
      ...decorateRul(cache[0]),
    });
  }

  // Cache stale - compute a fresh RUL from recent aggregates.
  //
  // The feature vector MUST be meaningfully different across equipment,
  // otherwise the MLP will emit the same number for every asset. We build
  // a 10-dim vector that matches the shape `synthetic_rul_dataset` trains
  // on (mean, std, min, max, p25_proxy, p75_proxy, range, last, slope, jerk)
  // computed from the equipment's own sensor history, and we bake the
  // equipment's lifecycle position (runtime / expected_life) into the
  // "age" of the signal so two assets with similar sensor noise but
  // different operating hours still get different RULs.
  let fresh = null;
  try {
    // Aggregate stats over the last 6 h, per equipment
    const { rows: statRows } = await query(
      `SELECT AVG(r.value)                AS avg_v,
              STDDEV_SAMP(r.value)        AS std_v,
              MAX(r.value)                AS max_v,
              MIN(r.value)                AS min_v,
              PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY r.value) AS p25_v,
              PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY r.value) AS p75_v,
              COUNT(*)::int               AS n
       FROM sensors s
       JOIN sensor_readings r ON r.sensor_id = s.sensor_id
       WHERE s.equipment_id = $1 AND r.ts > NOW() - INTERVAL '6 hours'`,
      [id]);

    // Also fetch the last value + approximate jerk for this equipment.
    // Jerk = mean absolute first-difference of consecutive readings; needs
    // a two-level CTE so we can aggregate *over* the window function.
    const { rows: dynRows } = await query(
      `WITH recent AS (
         SELECT r.value, r.ts
         FROM sensors s
         JOIN sensor_readings r ON r.sensor_id = s.sensor_id
         WHERE s.equipment_id = $1
           AND r.ts > NOW() - INTERVAL '6 hours'
         ORDER BY r.ts DESC
         LIMIT 200
       ),
       diffed AS (
         SELECT value,
                value - LAG(value) OVER (ORDER BY ts) AS dv,
                ts
         FROM recent
       )
       SELECT
         COALESCE((SELECT value FROM recent ORDER BY ts DESC LIMIT 1), 0) AS last_v,
         COALESCE(AVG(ABS(dv)), 0)                                         AS jerk_v
       FROM diffed`,
      [id]);

    const f = statRows[0] || {};
    const d = dynRows[0] || {};

    const avg = Number(f.avg_v) || 0;
    const std = Number(f.std_v) || 0;
    const mn  = Number(f.min_v) || 0;
    const mx  = Number(f.max_v) || 0;
    const p25 = Number(f.p25_v) || 0;
    const p75 = Number(f.p75_v) || 0;
    const n   = Number(f.n)     || 0;
    const last = Number(d.last_v) || 0;
    const jerk = Number(d.jerk_v) || 0;

    // Lifecycle "age" factor [0..1] — amplifies features proportional to
    // how far the asset is into its expected life. A brand-new pump and
    // an 80%-worn pump with identical recent vibration should get very
    // different RULs.
    const runtime = eq.runtime_hours != null ? Number(eq.runtime_hours) : 0;
    const expLife = eq.expected_life_hours != null ? Number(eq.expected_life_hours) : 0;
    const age = expLife > 0 ? Math.max(0, Math.min(1, runtime / expLife)) : 0;
    const ageBoost = 1 + 2 * age;   // young asset => 1.0, end-of-life => 3.0

    // slope of the recent window (end - start) / (n-1), approximated as
    // (last - avg) since we don't have the exact first value handy.
    const slope = n > 1 ? (last - avg) / Math.max(n - 1, 1) : 0;
    const range = mx - mn;

    // Feature vector — matches synthetic_rul_dataset's 10 dims exactly.
    const featureVec = [
      avg  * ageBoost,
      std  * ageBoost,
      mn,
      mx   * ageBoost,
      p25,
      p75  * ageBoost,
      range * ageBoost,
      last * ageBoost,
      slope,
      jerk * ageBoost,
    ];

    fresh = await mlClient.predictRul({
      equipment_id: id,
      features: featureVec,
      runtime_hours:       eq.runtime_hours != null ? Number(eq.runtime_hours) : undefined,
      expected_life_hours: eq.expected_life_hours != null ? Number(eq.expected_life_hours) : undefined,
    });
  } catch (err) {
    logger.warn('live RUL failed, falling back to cache (if any)', { err: err.message });
  }

  if (fresh) {
    // Cache it
    try {
      const modelId = await getActiveModelId('rul_mlp');
      await query(
        `INSERT INTO predictions_rul
           (ts, equipment_id, model_id, rul_hours,
            rul_lower_95, rul_upper_95, health_index)
         VALUES (NOW(), $1, $2, $3, $4, $5, $6)
         ON CONFLICT (equipment_id, ts) DO NOTHING`,
        [id, modelId, fresh.rul_hours,
         fresh.rul_lower_95, fresh.rul_upper_95, fresh.health_index]
      );
    } catch (err) {
      logger.warn('rul persistence failed', { err: err.message });
    }

    return res.json({
      equipment_id: id,
      equipment_tag: eq.tag_code,
      equipment_name: eq.name,
      ...decorateRul({ ...fresh, ts: new Date().toISOString() }),
    });
  }

  // No cache, no live result - return whatever stale row we have (if any)
  if (cache[0]) {
    return res.json({
      equipment_id: id,
      equipment_tag: eq.tag_code,
      equipment_name: eq.name,
      ...decorateRul(cache[0]),
    });
  }
  res.json(null);
});

/* --------------------------------------------------------------------- *
 * History endpoints
 * --------------------------------------------------------------------- */

const anomalyHistory = asyncHandler(async (req, res) => {
  const sensor_id = parseInt(req.params.sensor_id, 10);
  if (!Number.isFinite(sensor_id)) return res.json({ items: [] });
  const { rows } = await query(
    `SELECT ts, anomaly_score, is_anomaly
     FROM predictions_anomaly
     WHERE sensor_id = $1 AND ts > NOW() - INTERVAL '24 hours'
     ORDER BY ts ASC`, [sensor_id]);
  // Normalise to UI-friendly score (same scheme as predict endpoint)
  const items = rows.map(r => {
    const raw = Number(r.anomaly_score) || 0;
    return {
      ts: r.ts,
      created_at: r.ts,
      is_anomaly: !!r.is_anomaly,
      raw_score: raw,
      score: Math.max(0, Math.min(1, 0.5 - raw)),
    };
  });
  res.json({ items });
});

const failureHistory = asyncHandler(async (req, res) => {
  const equipment_id = parseInt(req.params.equipment_id, 10);
  if (!Number.isFinite(equipment_id)) return res.json({ items: [] });
  const { rows } = await query(
    `SELECT ts, horizon_days, failure_prob, predicted_class, confidence
     FROM predictions_failure
     WHERE equipment_id = $1 AND ts > NOW() - INTERVAL '30 days'
     ORDER BY ts ASC`, [equipment_id]);
  const items = rows.map(r => ({
    ts: r.ts,
    created_at: r.ts,
    horizon_days: r.horizon_days,
    failure_prob: Number(r.failure_prob) || 0,
    failure_probability: Number(r.failure_prob) || 0,
    predicted_class: r.predicted_class,
    confidence: r.confidence != null ? Number(r.confidence) : null,
  }));
  res.json({ items });
});

/* --------------------------------------------------------------------- *
 * Helpers
 * --------------------------------------------------------------------- */

async function getActiveModelId(name) {
  const { rows } = await query(
    `SELECT model_id FROM ml_models WHERE name = $1 AND is_active
     ORDER BY model_id DESC LIMIT 1`,
    [name]
  );
  return rows[0]?.model_id || null;
}

module.exports = {
  health, predictAnomaly, predictFailure,
  rulLatest, anomalyHistory, failureHistory,
};
