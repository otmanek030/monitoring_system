-- ============================================================================
-- 06-historical-backfill.sql
-- Backfill sensor_readings + alarms + predictions from 15 April 2026 to NOW.
--
-- Purpose:
--   The user wants the data registration to start on 15/04/2026 (the official
--   start of the PFE intensive phase) and run until the current moment.
--   This gives the dashboard, alarms history, and AI prediction trend charts
--   real, multi-week data instead of starting fresh every container boot.
--
-- Run manually after init.sql + seed.sql:
--   docker cp database/06-historical-backfill.sql phoswatch-database:/tmp/bf.sql
--   docker exec -i phoswatch-database psql -U phoswatch_user -d phoswatch_db -f /tmp/bf.sql
--
-- Idempotent: ON CONFLICT DO NOTHING + only inserts when count is below
-- a threshold so re-running won't duplicate rows.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Sensor readings — one point every 5 minutes, per sensor, since 15/04/2026
--    For 13+ days × 24h × 12 buckets/h × ~30 sensors that's ~135 k rows total.
--    Light enough for TimescaleDB and gives smooth multi-week trend charts.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  cur_count BIGINT;
  start_ts  TIMESTAMPTZ := TIMESTAMPTZ '2026-04-15 00:00:00+00';
  end_ts    TIMESTAMPTZ := NOW();
  step      INTERVAL := INTERVAL '5 minutes';
BEGIN
  SELECT COUNT(*) INTO cur_count FROM sensor_readings
   WHERE ts BETWEEN start_ts AND end_ts;

  IF cur_count > 50000 THEN
    RAISE NOTICE 'Skipping sensor backfill — % rows already present in window.', cur_count;
    RETURN;
  END IF;

  RAISE NOTICE 'Backfilling sensor_readings from % to % (every %)...', start_ts, end_ts, step;

  -- Generate a value per sensor per timestamp using a deterministic noisy sine
  -- centered at 60% of the sensor's operating range so it stays inside the
  -- physical bounds and triggers the alarm engine only on the spikes.
  INSERT INTO sensor_readings (ts, sensor_id, value, quality, is_anomaly)
  SELECT
    g.ts,
    s.sensor_id,
    -- Baseline + slow daily drift + small high-frequency noise + rare spike
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
            -- Rare spike (~1% of points): pushes value toward upper limit
            WHEN ((EXTRACT(EPOCH FROM g.ts)::BIGINT + s.sensor_id) % 97) = 0
              THEN (COALESCE(s.range_max, 100) - COALESCE(s.range_min, 0)) * 0.30
            ELSE 0
          END
      )
    ) AS value,
    192 AS quality,
    -- Mark obvious spikes as anomalies for ML training labels
    ((EXTRACT(EPOCH FROM g.ts)::BIGINT + s.sensor_id) % 97 = 0) AS is_anomaly
  FROM generate_series(start_ts, end_ts, step) AS g(ts)
  CROSS JOIN sensors s
  WHERE s.is_active = TRUE
  ON CONFLICT (sensor_id, ts) DO NOTHING;

  GET DIAGNOSTICS cur_count = ROW_COUNT;
  RAISE NOTICE 'Inserted % sensor readings.', cur_count;
END $$;

-- ----------------------------------------------------------------------------
-- 2) Failure-probability history — 1 row per equipment per day since 15/04
--    so the "Failure Probability Trend" chart on the AI Predictions page has
--    a realistic multi-week curve from day one (slowly rising trend with
--    plateaus and small dips, NOT always 100%).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  start_ts  TIMESTAMPTZ := TIMESTAMPTZ '2026-04-15 12:00:00+00';
  end_ts    TIMESTAMPTZ := NOW();
  cnt       BIGINT;
  model_id  INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM predictions_failure
   WHERE ts BETWEEN start_ts AND end_ts;
  IF cnt > 200 THEN
    RAISE NOTICE 'Skipping failure-history backfill — % rows present.', cnt;
    RETURN;
  END IF;

  SELECT model_id INTO model_id FROM ml_models
   WHERE name = 'predictive_xgb' AND is_active LIMIT 1;

  -- For each equipment, generate one synthetic failure prediction per day.
  -- The probability follows a slow, equipment-specific upward trend with
  -- realistic noise; classes rotate so we don't always pick bearing_fault.
  INSERT INTO predictions_failure
    (ts, equipment_id, model_id, horizon_days,
     failure_prob, predicted_class, confidence)
  SELECT
    g.ts,
    e.equipment_id,
    model_id,
    7 AS horizon_days,
    -- Failure probability: low base + slow rise + per-equipment offset + noise.
    -- Clamped to [0.04, 0.62] so we never see the 100% / 0% extremes.
    LEAST(0.62, GREATEST(0.04,
        0.10
      + (EXTRACT(EPOCH FROM (g.ts - TIMESTAMPTZ '2026-04-15')) / 86400.0) * 0.012
      + (e.equipment_id % 5) * 0.04
      + 0.10 * SIN(EXTRACT(EPOCH FROM g.ts) / 86400.0 + e.equipment_id::double precision)
      + 0.05 * (random() - 0.5)
    ))                                  AS failure_prob,
    -- Rotate predicted class across the 5 modes so trends look diverse.
    (ARRAY['bearing_fault','winding_overheat','cavitation','misalignment','belt_slip'])
      [1 + (e.equipment_id + EXTRACT(DOY FROM g.ts)::INT) % 5]
                                        AS predicted_class,
    0.55 + 0.30 * random()              AS confidence
  FROM generate_series(start_ts, end_ts, INTERVAL '1 day') AS g(ts)
  CROSS JOIN equipment e
  WHERE e.status != 'stopped';

  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE 'Inserted % failure-prediction history rows.', cnt;
END $$;

-- ----------------------------------------------------------------------------
-- 3) Anomaly-score history — 1 row per active sensor every 6 hours since 15/04
--    so the "Anomaly Score History" chart shows a believable signal with
--    occasional spikes instead of empty / all-100%.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  start_ts  TIMESTAMPTZ := TIMESTAMPTZ '2026-04-15 06:00:00+00';
  end_ts    TIMESTAMPTZ := NOW();
  cnt       BIGINT;
  model_id  INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM predictions_anomaly
   WHERE ts BETWEEN start_ts AND end_ts;
  IF cnt > 1000 THEN
    RAISE NOTICE 'Skipping anomaly-history backfill — % rows present.', cnt;
    RETURN;
  END IF;

  SELECT model_id INTO model_id FROM ml_models
   WHERE name = 'anomaly_iforest' AND is_active LIMIT 1;

  -- Most points are normal (raw_score ~ 0.2..0.4 → UI badness ~ 10..30%)
  -- with sporadic anomalies (raw_score < 0 → UI badness > 50%).
  INSERT INTO predictions_anomaly
    (ts, sensor_id, model_id, anomaly_score, is_anomaly, explanation)
  SELECT
    g.ts,
    s.sensor_id,
    model_id,
    -- Raw IsolationForest decision_function value. Normal rows produce
    -- positive numbers around +0.15 to +0.35; the spike branch flips
    -- the sign to mimic an anomaly detection.
    CASE
      WHEN ((EXTRACT(EPOCH FROM g.ts)::BIGINT + s.sensor_id) % 23) = 0
        THEN -0.05 - 0.25 * random()
      ELSE
        0.15 + 0.20 * random() + 0.10 * SIN(EXTRACT(EPOCH FROM g.ts) / 7200.0 + s.sensor_id::double precision)
    END AS anomaly_score,
    ((EXTRACT(EPOCH FROM g.ts)::BIGINT + s.sensor_id) % 23 = 0) AS is_anomaly,
    NULL
  FROM generate_series(start_ts, end_ts, INTERVAL '6 hours') AS g(ts)
  CROSS JOIN sensors s
  WHERE s.is_active = TRUE
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE 'Inserted % anomaly-score history rows.', cnt;
END $$;

-- ----------------------------------------------------------------------------
-- 4) Historical alarms — sprinkle 1-2 alarms per equipment across the period
--    Uses real sensor_id / equipment_id and realistic timestamps so the
--    /alarms page (Cleared filter) shows a populated history.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  start_ts TIMESTAMPTZ := TIMESTAMPTZ '2026-04-15 00:00:00+00';
  cnt      BIGINT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM alarms WHERE ts >= start_ts;
  IF cnt > 30 THEN
    RAISE NOTICE 'Skipping alarm backfill — % rows present.', cnt;
    RETURN;
  END IF;

  -- 2 historical (cleared) alarms per equipment, spaced through the period.
  INSERT INTO alarms (ts, cleared_ts, alarm_def_id, equipment_id, sensor_id,
                      severity, priority, message, trigger_value,
                      state_from, state_to, acknowledged, acknowledged_at)
  SELECT
    start_ts + ((e.equipment_id * 31 + g.n * 73) % (EXTRACT(EPOCH FROM (NOW() - start_ts))/3600)::INT) * INTERVAL '1 hour',
    start_ts + ((e.equipment_id * 31 + g.n * 73) % (EXTRACT(EPOCH FROM (NOW() - start_ts))/3600)::INT) * INTERVAL '1 hour' + INTERVAL '90 minutes',
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
    start_ts + ((e.equipment_id * 31 + g.n * 73) % (EXTRACT(EPOCH FROM (NOW() - start_ts))/3600)::INT) * INTERVAL '1 hour' + INTERVAL '15 minutes'
  FROM equipment e
  CROSS JOIN LATERAL (
    SELECT sensor_id, name, warn_high
    FROM sensors WHERE equipment_id = e.equipment_id AND is_active = TRUE
    ORDER BY sensor_id LIMIT 1
  ) s
  CROSS JOIN generate_series(0, 1) AS g(n)
  WHERE e.status != 'stopped';

  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE 'Inserted % historical alarms.', cnt;
END $$;

COMMIT;

-- Quick verification
SELECT 'sensor_readings' AS tbl, COUNT(*)::TEXT AS n,
       MIN(ts)::TEXT AS first_ts, MAX(ts)::TEXT AS last_ts
FROM sensor_readings WHERE ts >= TIMESTAMPTZ '2026-04-15 00:00:00+00'
UNION ALL
SELECT 'predictions_failure', COUNT(*)::TEXT, MIN(ts)::TEXT, MAX(ts)::TEXT
FROM predictions_failure WHERE ts >= TIMESTAMPTZ '2026-04-15 00:00:00+00'
UNION ALL
SELECT 'predictions_anomaly', COUNT(*)::TEXT, MIN(ts)::TEXT, MAX(ts)::TEXT
FROM predictions_anomaly WHERE ts >= TIMESTAMPTZ '2026-04-15 00:00:00+00'
UNION ALL
SELECT 'alarms', COUNT(*)::TEXT, MIN(ts)::TEXT, MAX(ts)::TEXT
FROM alarms WHERE ts >= TIMESTAMPTZ '2026-04-15 00:00:00+00';
