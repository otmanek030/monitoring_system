/**
 * ML predictions - thin pass-through to the Python ML service,
 * with caching of results in Postgres for historical trending.
 *
 * Endpoints:
 *   POST /api/predictions/anomaly     body: {sensor_id, window_minutes}
 *   POST /api/predictions/failure     body: {equipment_id, horizon_days}
 *   GET  /api/predictions/rul/:id     latest RUL for an equipment
 *   GET  /api/predictions/anomaly/:sensor_id/history
 *   GET  /api/predictions/failure/:equipment_id/history
 *   GET  /api/predictions/health      ML service health
 */
'use strict';

const mlClient = require('../services/mlClient');
const { query } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

const health = asyncHandler(async (_req, res) => {
  const out = await mlClient.health();
  res.json(out);
});

const predictAnomaly = asyncHandler(async (req, res) => {
  const { sensor_id, window_minutes = 30 } = req.body || {};
  if (!sensor_id) throw new ApiError(400, 'sensor_id required');

  // Fetch recent values to send to ML
  const { rows: pts } = await query(
    `SELECT ts, value FROM sensor_readings
     WHERE sensor_id = $1 AND ts > NOW() - ($2::int || ' minutes')::interval
     ORDER BY ts ASC`,
    [sensor_id, window_minutes]
  );
  if (pts.length < 10) throw new ApiError(400, 'not enough recent data');

  const result = await mlClient.predictAnomaly({
    sensor_id,
    values: pts.map(p => Number(p.value)),
    timestamps: pts.map(p => p.ts),
  });

  // Persist the decision of the latest point
  if (result.is_anomaly !== undefined) {
    const modelId = await getActiveModelId('anomaly_iforest');
    await query(
      `INSERT INTO predictions_anomaly (ts, sensor_id, model_id, anomaly_score, is_anomaly, explanation)
       VALUES (NOW(), $1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [sensor_id, modelId, result.score ?? null, !!result.is_anomaly, result.explanation || null]
    );
  }
  res.json(result);
});

const predictFailure = asyncHandler(async (req, res) => {
  const { equipment_id, horizon_days = 7 } = req.body || {};
  if (!equipment_id) throw new ApiError(400, 'equipment_id required');

  // Build the feature snapshot from recent sensor aggregates
  const { rows: feats } = await query(
    `SELECT s.tag_code, s.measurement,
            AVG(r.value) AS avg_v, MAX(r.value) AS max_v,
            STDDEV(r.value) AS std_v
     FROM sensors s
     JOIN sensor_readings r ON r.sensor_id = s.sensor_id
     WHERE s.equipment_id = $1
       AND r.ts > NOW() - INTERVAL '6 hours'
     GROUP BY s.tag_code, s.measurement`,
    [equipment_id]
  );

  const out = await mlClient.predictFailure({
    equipment_id, horizon_days, features: feats,
  });

  const modelId = await getActiveModelId('predictive_xgb');
  await query(
    `INSERT INTO predictions_failure
       (ts, equipment_id, model_id, horizon_days, failure_prob, predicted_class, confidence)
     VALUES (NOW(), $1, $2, $3, $4, $5, $6)`,
    [equipment_id, modelId, horizon_days, out.failure_prob, out.predicted_class || null, out.confidence || null]
  );
  res.json(out);
});

const rulLatest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await query(
    `SELECT * FROM predictions_rul WHERE equipment_id = $1
     ORDER BY ts DESC LIMIT 1`, [id]);
  res.json(rows[0] || null);
});

const anomalyHistory = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT ts, anomaly_score, is_anomaly
     FROM predictions_anomaly
     WHERE sensor_id = $1 AND ts > NOW() - INTERVAL '24 hours'
     ORDER BY ts ASC`, [req.params.sensor_id]);
  res.json(rows);
});

const failureHistory = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT ts, horizon_days, failure_prob, predicted_class, confidence
     FROM predictions_failure
     WHERE equipment_id = $1 AND ts > NOW() - INTERVAL '30 days'
     ORDER BY ts ASC`, [req.params.equipment_id]);
  res.json(rows);
});

async function getActiveModelId(name) {
  const { rows } = await query(
    `SELECT model_id FROM ml_models WHERE name = $1 AND is_active ORDER BY model_id DESC LIMIT 1`,
    [name]
  );
  return rows[0]?.model_id || null;
}

module.exports = {
  health, predictAnomaly, predictFailure, rulLatest, anomalyHistory, failureHistory,
};
