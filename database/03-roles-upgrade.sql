-- ============================================================================
-- 03-roles-upgrade.sql
-- Migration: role differentiation + operator shift notes
--
-- Run manually (first boot only runs init.sql + seed.sql):
--   docker cp database/03-roles-upgrade.sql phoswatch-database:/tmp/mig.sql
--   docker exec -i phoswatch-database psql -U phoswatch_user -d phoswatch_db -f /tmp/mig.sql
--
-- Makes each role meaningfully different:
--   - operator    : sees dashboard, acks alarms, writes SHIFT NOTES, exports
--                   their own shift PDF report
--   - technician  : operator + executes work orders assigned to them
--                   (updates maintenance status, closes WOs)
--   - supervisor  : technician + EDITS THRESHOLDS, ASSIGNS work orders,
--                   manages predictions, approves reports
--   - admin       : wildcard (user mgmt, all CRUD)
--   - viewer      : read-only
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Shift notes (operator's logbook)
-- ---------------------------------------------------------------------------
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
);

CREATE INDEX IF NOT EXISTS idx_operator_notes_user_created
  ON operator_notes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_notes_equipment
  ON operator_notes (equipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_notes_created
  ON operator_notes (created_at DESC);

-- Keep updated_at fresh on edits
CREATE OR REPLACE FUNCTION trg_operator_notes_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS operator_notes_touch ON operator_notes;
CREATE TRIGGER operator_notes_touch
  BEFORE UPDATE ON operator_notes
  FOR EACH ROW EXECUTE FUNCTION trg_operator_notes_touch();

-- ---------------------------------------------------------------------------
-- 2) Rewrite roles.permissions so each role can do something different
-- ---------------------------------------------------------------------------
-- Resource / action conventions used by backend middleware requirePerm(r,a):
--   r = read, w = write (create/update), d = delete, x = execute
--   "*" or true = full access, "rw" = read+write, etc.
--
-- Resources:
--   dashboard, equipment, sensors, thresholds, alarms, maintenance,
--   assign_maintenance, predictions, reports, notes, my_shift, users

UPDATE roles SET permissions = '{"*":"*"}'::jsonb
 WHERE code = 'admin';

UPDATE roles SET permissions = jsonb_build_object(
  'dashboard',          'r',
  'equipment',          'rw',
  'sensors',            'rw',
  'thresholds',         'w',
  'alarms',             'rw',
  'maintenance',        'rw',
  'assign_maintenance', 'w',
  'predictions',        'rw',
  'reports',            'rw',
  'notes',              'rw',
  'my_shift',           'rw',
  'users',              'r'
) WHERE code = 'supervisor';

UPDATE roles SET permissions = jsonb_build_object(
  'dashboard',   'r',
  'equipment',   'rw',
  'sensors',     'r',
  'alarms',      'rw',
  'maintenance', 'rw',
  'predictions', 'rw',
  'reports',     'r',
  'notes',       'rw',
  'my_shift',    'rw'
) WHERE code = 'technician';

UPDATE roles SET permissions = jsonb_build_object(
  'dashboard',   'r',
  'equipment',   'r',
  'sensors',     'r',
  'alarms',      'rw',
  'maintenance', 'r',
  'notes',       'rw',
  'reports',     'r',
  'my_shift',    'rw'
) WHERE code = 'operator';

UPDATE roles SET permissions = jsonb_build_object(
  'dashboard', 'r',
  'equipment', 'r',
  'alarms',    'r',
  'reports',   'r'
) WHERE code = 'viewer';

COMMIT;

-- Sanity check
SELECT code, permissions FROM roles ORDER BY code;
