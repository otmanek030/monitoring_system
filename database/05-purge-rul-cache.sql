-- ============================================================================
-- 05-purge-rul-cache.sql
-- Purge every cached RUL prediction so the next dashboard hit re-runs the
-- model end-to-end per equipment.
--
-- Why: the RUL MLP was retrained on a new label distribution [24 h, 2160 h]
-- (90-day maintenance window) with a more discriminative feature vector.
-- Every row currently sitting in `predictions_rul` was produced by the old
-- model and will keep showing identical values across assets until the
-- cache expires naturally (1 h). Truncating is much faster.
--
-- Safe to re-run — the table will refill on its own as the UI requests
-- predictions for each equipment.
-- ============================================================================

BEGIN;

DELETE FROM predictions_rul;

COMMIT;

-- Quick sanity check
SELECT COUNT(*) AS remaining_rul_rows FROM predictions_rul;
