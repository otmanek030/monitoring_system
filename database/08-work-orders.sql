-- ============================================================================
-- 08-work-orders.sql
-- Auto-generated maintenance work order draft system.
--
-- Why: when a predictive alert fires (failure_prob >= threshold or RUL drops
-- below a critical horizon) we want to immediately draft a work order with
-- the recommended action and queue it for supervisor approval. Approval
-- promotes the draft into a real maintenance_orders row, which the existing
-- maintenance UI already handles.
--
-- This migration is idempotent (uses IF NOT EXISTS).
--
-- Run:
--   docker cp database/08-work-orders.sql phoswatch-database:/tmp/wo.sql
--   docker exec -i phoswatch-database psql -U phoswatch_user -d phoswatch_db -f /tmp/wo.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS work_orders (
    work_order_id     SERIAL PRIMARY KEY,
    equipment_id      INT NOT NULL REFERENCES equipment(equipment_id) ON DELETE CASCADE,

    -- Predicted failure context
    predicted_failure_type  VARCHAR(64),                 -- bearing_fault | cavitation | ...
    failure_probability     DOUBLE PRECISION,            -- 0..1
    rul_hours               DOUBLE PRECISION,            -- if from RUL model
    health_index            DOUBLE PRECISION,            -- 0..100

    -- Operator-facing fields
    title             VARCHAR(200) NOT NULL,
    description       TEXT,
    recommended_action TEXT,
    suggested_parts   TEXT,                              -- e.g. "Bearing 6205-2RS, grease NLGI-2"
    urgency           VARCHAR(16) NOT NULL DEFAULT 'normal'
                       CHECK (urgency IN ('low','normal','high','urgent','critical')),

    -- Workflow
    status            VARCHAR(16) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected','converted','cancelled')),
    rejection_reason  TEXT,
    -- Once approved, link to the real maintenance order created from this draft
    converted_to_order_id  INT REFERENCES maintenance_orders(order_id) ON DELETE SET NULL,

    -- Provenance
    source            VARCHAR(32) NOT NULL DEFAULT 'auto'
                       CHECK (source IN ('auto','manual','prediction','rul','cascade')),
    triggered_by_prediction_id BIGINT,                   -- predictions_failure.prediction_id (nullable)

    created_by        INT REFERENCES users(user_id),
    approved_by       INT REFERENCES users(user_id),
    approved_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wo_equipment ON work_orders(equipment_id);
CREATE INDEX IF NOT EXISTS idx_wo_status    ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_wo_created   ON work_orders(created_at DESC);

-- Prevent duplicate auto-drafts for the same equipment/failure-type still pending
CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_pending_dedup
    ON work_orders (equipment_id, predicted_failure_type)
    WHERE status = 'pending' AND source <> 'manual';

-- Touch trigger for updated_at
CREATE OR REPLACE FUNCTION work_orders_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wo_updated_at ON work_orders;
CREATE TRIGGER trg_wo_updated_at
    BEFORE UPDATE ON work_orders
    FOR EACH ROW EXECUTE FUNCTION work_orders_touch_updated_at();

-- Grant the new `work_orders` resource on the JSONB permissions column.
--   admin / supervisor : rw  (can approve / reject / create manually)
--   technician/operator: r   (can read drafts and converted orders)
--   viewer             : r
UPDATE roles
   SET permissions = permissions || jsonb_build_object('work_orders', 'rw')
 WHERE code IN ('admin','supervisor');

UPDATE roles
   SET permissions = permissions || jsonb_build_object('work_orders', 'r')
 WHERE code IN ('technician','operator','viewer')
   AND (permissions->>'work_orders' IS NULL);

COMMIT;
