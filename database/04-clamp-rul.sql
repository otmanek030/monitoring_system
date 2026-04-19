-- ============================================================================
-- 04-clamp-rul.sql
-- Clamp historical RUL predictions to a realistic [1 h, 90 d] window.
--
-- Older rows in `predictions_rul` can hold multi-year / multi-decade values
-- coming from a drifted MLP regressor. The ML service and the Node backend
-- now clamp at write + read time, but any already-persisted garbage would
-- keep propagating on cache hits. This migration normalises the historical
-- rows once so the dashboard immediately shows sensible numbers.
-- ============================================================================

BEGIN;

UPDATE predictions_rul
SET rul_hours    = LEAST(GREATEST(rul_hours,    1), 90 * 24),
    rul_lower_95 = LEAST(GREATEST(rul_lower_95, 1), 90 * 24),
    rul_upper_95 = LEAST(GREATEST(rul_upper_95, 1), 90 * 24)
WHERE rul_hours > 90 * 24
   OR rul_hours < 1
   OR rul_lower_95 > 90 * 24
   OR rul_upper_95 > 90 * 24;

COMMIT;

-- Report how many rows were touched (for manual verification)
SELECT COUNT(*) AS rows_now_within_bounds
FROM predictions_rul
WHERE rul_hours BETWEEN 1 AND 90 * 24;
