/**
 * predictionScheduler.js
 *
 * Runs anomaly + failure predictions on every active sensor / equipment
 * automatically, on a fixed cadence, with no user interaction required.
 *
 * Flow per cycle:
 *   1. Anomaly scoring  — every active sensor, last 30 min window, push
 *      result on the `prediction:anomaly` WebSocket event.
 *   2. Failure scoring  — every running equipment, 7-day horizon, push
 *      result on the `prediction:failure` WebSocket event.
 *   3. Persist to predictions_anomaly / predictions_failure so the
 *      history charts on the Predictions page have continuity.
 *
 * Cadence: anomaly cycle every 60 s, failure cycle every 5 min. Both
 * are async-staggered and rate-limited so we don't melt the ML service.
 *
 * The scheduler is a no-op when DATA_GENERATOR_ENABLED is false, so test
 * runs don't accidentally fan-out to the ML container.
 */
'use strict';

const env = require('../config/env');
const logger = require('../config/logger');
const { query } = require('../config/db');
const mlClient = require('./mlClient');

const ANOMALY_INTERVAL_MS = 60_000;       // every minute
const FAILURE_INTERVAL_MS = 5 * 60_000;   // every 5 minutes
const ANOMALY_PARALLEL    = 4;             // concurrent ML calls per cycle
const FAILURE_PARALLEL    = 2;
const ANOMALY_WINDOW_MIN  = 30;

let broadcaster = null;
let timers = [];
let running = false;

/* ── Helpers ───────────────────────────────────────────────────────── */
async function _activeModelId(name) {
  try {
    const { rows } = await query(
      `SELECT model_id FROM ml_models
       WHERE name = $1 AND is_active
       ORDER BY model_id DESC LIMIT 1`,
      [name]
    );
    return rows[0]?.model_id || null;
  } catch { return null; }
}

/** Run N async tasks at most P at a time. Resolves when all complete. */
async function _withConcurrency(items, parallel, worker) {
  const chunks = [];
  for (let i = 0; i < items.length; i += parallel) chunks.push(items.slice(i, i + parallel));
  for (const c of chunks) await Promise.all(c.map(worker));
}

/* ── Anomaly cycle ─────────────────────────────────────────────────── */
async function runAnomalyCycle() {
  try {
    const { rows: sensors } = await query(
      `SELECT s.sensor_id, s.tag_code, s.equipment_id, e.tag_code AS equipment_tag
       FROM sensors s
       JOIN equipment e ON e.equipment_id = s.equipment_id
       WHERE s.is_active = TRUE AND e.status = 'running'`);

    if (!sensors.length) return;
    const modelId = await _activeModelId('anomaly_iforest');

    await _withConcurrency(sensors, ANOMALY_PARALLEL, async (s) => {
      try {
        // Pull recent values
        const { rows: pts } = await query(
          `SELECT ts, value FROM sensor_readings
           WHERE sensor_id = $1 AND ts > NOW() - ($2::int || ' minutes')::interval
           ORDER BY ts ASC`,
          [s.sensor_id, ANOMALY_WINDOW_MIN]);
        if (pts.length < 10) return;          // not enough data

        const result = await mlClient.predictAnomaly({
          sensor_id:  s.sensor_id,
          values:     pts.map(p => Number(p.value)),
          timestamps: pts.map(p => p.ts),
        });

        // Persist (UI history chart reads from here)
        try {
          await query(
            `INSERT INTO predictions_anomaly
               (ts, sensor_id, model_id, anomaly_score, is_anomaly, explanation)
             VALUES (NOW(), $1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [s.sensor_id, modelId, result.score ?? null, !!result.is_anomaly,
             result.explanation ? JSON.stringify(result.explanation) : null]);
        } catch {/* swallow — non-fatal */}

        // Normalise to UI 0..1 (mirrors mlController)
        const raw = Number(result.score) || 0;
        const ui_score = Math.max(0, Math.min(1, 0.5 - raw));
        const conf = Math.max(0, Math.min(1, Math.abs(raw) * 2));

        // Broadcast
        if (broadcaster) {
          broadcaster.emit('prediction:anomaly', {
            sensor_id:    s.sensor_id,
            sensor_tag:   s.tag_code,
            equipment_id: s.equipment_id,
            equipment_tag:s.equipment_tag,
            score:        ui_score,
            raw_score:    raw,
            is_anomaly:   !!result.is_anomaly,
            confidence:   conf,
            ts:           new Date().toISOString(),
          });
        }
      } catch (err) {
        logger.debug('anomaly cycle item failed', {
          sensor: s.sensor_id, err: err.message,
        });
      }
    });
  } catch (err) {
    logger.warn('anomaly cycle failed', { err: err.message });
  }
}

/* ── Failure cycle ─────────────────────────────────────────────────── */
async function runFailureCycle() {
  try {
    const { rows: eqs } = await query(
      `SELECT equipment_id, tag_code, name FROM equipment
       WHERE status = 'running' OR status = 'idle'`);
    if (!eqs.length) return;
    const modelId = await _activeModelId('predictive_xgb');

    await _withConcurrency(eqs, FAILURE_PARALLEL, async (eq) => {
      try {
        // Aggregate last 6 h per sensor → feature vector
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
          [eq.equipment_id]);
        if (!feats.length) return;

        const features = feats.map(f => ({
          tag_code:    f.tag_code,
          measurement: f.measurement,
          avg_v: f.avg_v != null ? Number(f.avg_v) : 0,
          max_v: f.max_v != null ? Number(f.max_v) : 0,
          std_v: f.std_v != null ? Number(f.std_v) : 0,
        }));

        const out = await mlClient.predictFailure({
          equipment_id: eq.equipment_id,
          horizon_days: 7,
          features,
        });

        const failure_prob = Number(out.failure_prob) || 0;
        const predicted_class = out.predicted_class
          || (failure_prob > 0.5 ? 'bearing_fault' : null);
        const confidence = Number(out.confidence)
          || Math.abs(failure_prob - 0.5) * 2;

        // Persist
        try {
          await query(
            `INSERT INTO predictions_failure
               (ts, equipment_id, model_id, horizon_days,
                failure_prob, predicted_class, confidence)
             VALUES (NOW(), $1, $2, 7, $3, $4, $5)`,
            [eq.equipment_id, modelId, failure_prob, predicted_class, confidence]);
        } catch {/* swallow */}

        if (broadcaster) {
          broadcaster.emit('prediction:failure', {
            equipment_id:        eq.equipment_id,
            equipment_tag:       eq.tag_code,
            equipment_name:      eq.name,
            horizon_days:        7,
            failure_probability: failure_prob,
            failure_prob,
            predicted_class,
            confidence,
            mode_probabilities:  out.mode_probabilities || null,
            ts:                  new Date().toISOString(),
          });
        }
      } catch (err) {
        logger.debug('failure cycle item failed', {
          equipment: eq.equipment_id, err: err.message,
        });
      }
    });
  } catch (err) {
    logger.warn('failure cycle failed', { err: err.message });
  }
}

/* ── Lifecycle ─────────────────────────────────────────────────────── */
async function start(emitter) {
  if (running) return;
  if (!env.dataGenerator.enabled) {
    logger.info('prediction scheduler disabled (data generator off)');
    return;
  }
  broadcaster = emitter;
  running = true;
  logger.info('prediction scheduler starting', {
    anomalyMs: ANOMALY_INTERVAL_MS, failureMs: FAILURE_INTERVAL_MS,
  });

  // Stagger first runs by 15 s so the freshly-booted backend can finish its
  // initial backfill / data-gen warmup before we start scoring.
  timers.push(setTimeout(() => {
    runAnomalyCycle().catch(() => {});
    timers.push(setInterval(() => runAnomalyCycle().catch(() => {}), ANOMALY_INTERVAL_MS));
  }, 15_000));

  timers.push(setTimeout(() => {
    runFailureCycle().catch(() => {});
    timers.push(setInterval(() => runFailureCycle().catch(() => {}), FAILURE_INTERVAL_MS));
  }, 30_000));
}

function stop() {
  for (const t of timers) {
    clearTimeout(t); clearInterval(t);
  }
  timers = [];
  running = false;
}

module.exports = { start, stop };
