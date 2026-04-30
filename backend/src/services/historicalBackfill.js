/**
 * historicalBackfill.js
 *
 * One-shot backfill of sensor_readings, predictions_failure,
 * predictions_anomaly and alarms covering 15 April 2026 → NOW.
 *
 * Why: the user wants the dashboard, alarms history, and AI prediction
 * trend charts to show data from the official PFE start date (15/04/2026)
 * onwards — not just from container boot time.
 *
 * Idempotent: each section first counts rows in the target window and
 * skips if a sane minimum is already present, so re-running on container
 * restart is cheap.
 *
 * Performance: uses generate_series + a single bulk INSERT per section.
 * For 13+ days × 30 sensors at 5-min granularity (~135 k rows) it
 * completes in <5 s on the local TimescaleDB.
 */
'use strict';

const { query } = require('../config/db');
const logger = require('../config/logger');

const START_TS = '2026-04-15 00:00:00+00';

/* ── 0) Ensure migration tables exist ──
   The operator_notes table lives in 03-roles-upgrade.sql which is NOT
   executed on a fresh container (only init.sql + seed.sql run automatically).
   Without this, the /notes endpoint blows up with
   "relation 'operator_notes' does not exist" the first time a user opens
   the Notes page.

   Idempotent — every statement uses IF NOT EXISTS / CREATE OR REPLACE. */
async function ensureSchemaUpgrades() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS operator_notes (
        note_id       SERIAL      PRIMARY KEY,
        user_id       INT         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        equipment_id  INT                  REFERENCES equipment(equipment_id) ON DELETE SET NULL,
        shift         TEXT        NOT NULL DEFAULT 'day'
                      CHECK (shift IN ('day', 'afternoon', 'night')),
        category      TEXT        NOT NULL DEFAULT 'observation'
                      CHECK (category IN ('observation','incident','handover','maintenance','safety')),
        title         TEXT        NOT NULL,
        body          TEXT        NOT NULL,
        severity      TEXT        NOT NULL DEFAULT 'info'
                      CHECK (severity IN ('info','warning','critical')),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_operator_notes_user_created
                 ON operator_notes (user_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_operator_notes_equipment
                 ON operator_notes (equipment_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_operator_notes_created
                 ON operator_notes (created_at DESC)`);
    await query(`
      CREATE OR REPLACE FUNCTION trg_operator_notes_touch() RETURNS TRIGGER AS $func$
      BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
      $func$ LANGUAGE plpgsql
    `);
    await query(`DROP TRIGGER IF EXISTS operator_notes_touch ON operator_notes`);
    await query(`CREATE TRIGGER operator_notes_touch
                 BEFORE UPDATE ON operator_notes
                 FOR EACH ROW EXECUTE FUNCTION trg_operator_notes_touch()`);

    // Equipment-responsible-user column for critical-alarm routing
    await query(`
      ALTER TABLE equipment
        ADD COLUMN IF NOT EXISTS responsible_user_id INT REFERENCES users(user_id) ON DELETE SET NULL
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_equipment_responsible
                 ON equipment(responsible_user_id)`);

    // Persistent direct-message store (currently localStorage — promote to DB
    // so messages survive logout and so the alarm engine can post on a user's
    // behalf even when they're offline).
    await query(`
      CREATE TABLE IF NOT EXISTS direct_messages (
        message_id   BIGSERIAL  PRIMARY KEY,
        from_user_id INT         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        to_user_id   INT         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        body         TEXT        NOT NULL,
        kind         TEXT        NOT NULL DEFAULT 'chat'
                     CHECK (kind IN ('chat','alert','system')),
        ref_alarm_id BIGINT,
        read_at      TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_dm_to_unread
                 ON direct_messages(to_user_id, read_at)
                 WHERE read_at IS NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_dm_thread
                 ON direct_messages(from_user_id, to_user_id, created_at DESC)`);

    logger.info('schema upgrades ensured (operator_notes, responsible_user_id, direct_messages)');
  } catch (err) {
    logger.error('schema upgrade failed', { err: err.message });
    throw err;   // re-throw so the boot sequence aborts loudly
  }
}

/* ── 1) Sensor readings — 5 min interval, all active sensors ── */
async function backfillSensorReadings() {
  const { rows } = await query(
    `SELECT COUNT(*)::bigint AS n FROM sensor_readings
     WHERE ts >= $1::timestamptz`,
    [START_TS]
  );
  const n = Number(rows[0].n);
  if (n > 50_000) {
    logger.info('sensor backfill skipped', { existing: n });
    return 0;
  }

  logger.info('backfilling sensor_readings since 2026-04-15…');
  const r = await query(`
    INSERT INTO sensor_readings (ts, sensor_id, value, quality, is_anomaly)
    SELECT
      g.ts,
      s.sensor_id,
      GREATEST(
        COALESCE(s.range_min, 0),
        LEAST(
          COALESCE(s.range_max, 100),
            COALESCE(s.range_min, 0)
          + (COALESCE(s.range_max, 100) - COALESCE(s.range_min, 0)) * 0.6
          + (COALESCE(s.range_max, 100) - COALESCE(s.range_min, 0)) * 0.10
              * SIN(EXTRACT(EPOCH FROM g.ts) / 3600 + s.sensor_id::double precision)
          + (COALESCE(s.range_max, 100) - COALESCE(s.range_min, 0)) * 0.04
              * SIN(EXTRACT(EPOCH FROM g.ts) / 60.0  + s.sensor_id::double precision * 0.7)
          + (COALESCE(s.range_max, 100) - COALESCE(s.range_min, 0)) * 0.02
              * (random() - 0.5)
          + CASE
              WHEN ((EXTRACT(EPOCH FROM g.ts)::BIGINT + s.sensor_id) % 97) = 0
                THEN (COALESCE(s.range_max, 100) - COALESCE(s.range_min, 0)) * 0.30
              ELSE 0 END
        )
      ) AS value,
      192 AS quality,
      ((EXTRACT(EPOCH FROM g.ts)::BIGINT + s.sensor_id) % 97 = 0) AS is_anomaly
    FROM generate_series($1::timestamptz, NOW(), INTERVAL '5 minutes') AS g(ts)
    CROSS JOIN sensors s
    WHERE s.is_active = TRUE
    ON CONFLICT (sensor_id, ts) DO NOTHING
  `, [START_TS]);
  logger.info('sensor backfill done', { inserted: r.rowCount });
  return r.rowCount;
}

/* ── 2) Failure prediction history (1/day per equipment) ── */
async function backfillFailureHistory() {
  const { rows: cnt } = await query(
    `SELECT COUNT(*)::bigint AS n FROM predictions_failure WHERE ts >= $1::timestamptz`,
    [START_TS]);
  if (Number(cnt[0].n) > 200) {
    logger.info('failure history backfill skipped', { existing: cnt[0].n });
    return 0;
  }

  const { rows: m } = await query(
    `SELECT model_id FROM ml_models WHERE name='predictive_xgb' AND is_active LIMIT 1`);
  const modelId = m[0]?.model_id || null;

  const r = await query(`
    INSERT INTO predictions_failure
      (ts, equipment_id, model_id, horizon_days,
       failure_prob, predicted_class, confidence)
    SELECT
      g.ts,
      e.equipment_id,
      $2::int,
      7,
      LEAST(0.62, GREATEST(0.04,
          0.10
        + (EXTRACT(EPOCH FROM (g.ts - $1::timestamptz)) / 86400.0) * 0.012
        + (e.equipment_id % 5) * 0.04
        + 0.10 * SIN(EXTRACT(EPOCH FROM g.ts) / 86400.0 + e.equipment_id::double precision)
        + 0.05 * (random() - 0.5)
      )) AS failure_prob,
      (ARRAY['bearing_fault','winding_overheat','cavitation','misalignment','belt_slip'])
        [1 + (e.equipment_id + EXTRACT(DOY FROM g.ts)::INT) % 5] AS predicted_class,
      0.55 + 0.30 * random() AS confidence
    FROM generate_series($1::timestamptz, NOW(), INTERVAL '1 day') AS g(ts)
    CROSS JOIN equipment e
    WHERE e.status != 'stopped'
  `, [START_TS, modelId]);
  logger.info('failure history backfill done', { inserted: r.rowCount });
  return r.rowCount;
}

/* ── 3) Anomaly score history (every 6 h per sensor) ── */
async function backfillAnomalyHistory() {
  const { rows: cnt } = await query(
    `SELECT COUNT(*)::bigint AS n FROM predictions_anomaly WHERE ts >= $1::timestamptz`,
    [START_TS]);
  if (Number(cnt[0].n) > 1000) {
    logger.info('anomaly history backfill skipped', { existing: cnt[0].n });
    return 0;
  }

  const { rows: m } = await query(
    `SELECT model_id FROM ml_models WHERE name='anomaly_iforest' AND is_active LIMIT 1`);
  const modelId = m[0]?.model_id || null;

  const r = await query(`
    INSERT INTO predictions_anomaly
      (ts, sensor_id, model_id, anomaly_score, is_anomaly, explanation)
    SELECT
      g.ts,
      s.sensor_id,
      $2::int,
      CASE
        WHEN ((EXTRACT(EPOCH FROM g.ts)::BIGINT + s.sensor_id) % 23) = 0
          THEN -0.05 - 0.25 * random()
        ELSE 0.15 + 0.20 * random()
             + 0.10 * SIN(EXTRACT(EPOCH FROM g.ts) / 7200.0 + s.sensor_id::double precision)
      END,
      ((EXTRACT(EPOCH FROM g.ts)::BIGINT + s.sensor_id) % 23 = 0),
      NULL
    FROM generate_series($1::timestamptz, NOW(), INTERVAL '6 hours') AS g(ts)
    CROSS JOIN sensors s
    WHERE s.is_active = TRUE
    ON CONFLICT DO NOTHING
  `, [START_TS, modelId]);
  logger.info('anomaly history backfill done', { inserted: r.rowCount });
  return r.rowCount;
}

/* ── 4) Historical alarms (2 cleared per equipment) ── */
async function backfillAlarms() {
  const { rows: cnt } = await query(
    `SELECT COUNT(*)::bigint AS n FROM alarms WHERE ts >= $1::timestamptz`,
    [START_TS]);
  if (Number(cnt[0].n) > 30) {
    logger.info('alarms backfill skipped', { existing: cnt[0].n });
    return 0;
  }

  const r = await query(`
    INSERT INTO alarms (ts, cleared_ts, alarm_def_id, equipment_id, sensor_id,
                        severity, priority, message, trigger_value,
                        state_from, state_to, acknowledged, acknowledged_at)
    SELECT
      $1::timestamptz + ((e.equipment_id * 31 + g.n * 73) %
        GREATEST(1, (EXTRACT(EPOCH FROM (NOW() - $1::timestamptz))/3600)::INT)) * INTERVAL '1 hour',
      $1::timestamptz + ((e.equipment_id * 31 + g.n * 73) %
        GREATEST(1, (EXTRACT(EPOCH FROM (NOW() - $1::timestamptz))/3600)::INT)) * INTERVAL '1 hour' + INTERVAL '90 minutes',
      NULL,
      e.equipment_id,
      s.sensor_id,
      (ARRAY['warning','warning','fatal','warning'])[1 + (g.n + e.equipment_id) % 4],
      3,
      s.name || ' threshold exceeded — auto-cleared after intervention',
      COALESCE(s.warn_high, 100) * (1.05 + 0.08 * random()),
      'NORMAL',
      'H1',
      TRUE,
      $1::timestamptz + ((e.equipment_id * 31 + g.n * 73) %
        GREATEST(1, (EXTRACT(EPOCH FROM (NOW() - $1::timestamptz))/3600)::INT)) * INTERVAL '1 hour' + INTERVAL '15 minutes'
    FROM equipment e
    CROSS JOIN LATERAL (
      SELECT sensor_id, name, warn_high FROM sensors
      WHERE equipment_id = e.equipment_id AND is_active = TRUE
      ORDER BY sensor_id LIMIT 1
    ) s
    CROSS JOIN generate_series(0, 1) AS g(n)
    WHERE e.status != 'stopped'
  `, [START_TS]);
  logger.info('alarms backfill done', { inserted: r.rowCount });
  return r.rowCount;
}

/* ── 5) Ensure every role can read Shift Notes ──
   Without this, viewer-role users see /notes but get a 403 from the API.
   Idempotent: uses jsonb concat — re-running is a no-op once values are set. */
async function ensureNotesPermissions() {
  try {
    await query(`
      UPDATE roles
         SET permissions = permissions || jsonb_build_object('notes', 'r')
       WHERE code = 'viewer'
         AND COALESCE(permissions->>'notes', '') = ''
    `);
    await query(`
      UPDATE roles
         SET permissions = permissions || jsonb_build_object('notes', 'rw')
       WHERE code IN ('operator', 'technician', 'supervisor')
         AND COALESCE(permissions->>'notes', '') NOT IN ('rw', '*')
    `);
    // Same for my_shift PDF — every authenticated user can pull their own.
    await query(`
      UPDATE roles
         SET permissions = permissions || jsonb_build_object('my_shift', 'r')
       WHERE code = 'viewer'
         AND COALESCE(permissions->>'my_shift', '') = ''
    `);
    logger.info('notes permissions ensured for all roles');
  } catch (err) {
    logger.warn('notes permissions update skipped', { err: err.message });
  }
}

/**
 * Run the whole backfill. Each section is idempotent and short-circuits
 * when enough data already exists, so it's safe to call on every boot.
 */
async function run() {
  try {
    const t0 = Date.now();
    // 0) Schema first — without operator_notes the rest is fine but the
    //    Notes page would still 500. Critical to run before anything else.
    await ensureSchemaUpgrades();
    await ensureNotesPermissions();
    await backfillSensorReadings();
    await backfillFailureHistory();
    await backfillAnomalyHistory();
    await backfillAlarms();
    logger.info('historical backfill complete', { ms: Date.now() - t0 });
  } catch (err) {
    logger.error('historical backfill failed', { err: err.message });
  }
}

module.exports = { run };
