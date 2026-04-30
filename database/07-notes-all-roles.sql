-- ============================================================================
-- 07-notes-all-roles.sql
-- Make the Shift Notes page visible & usable for every authenticated user.
--
-- Why: the previous role permissions only granted `notes` to operator,
-- technician, supervisor, admin. Viewer-role users couldn't even open the
-- /notes page because the backend rejected /api/notes with 403.
--
-- Fix: grant `notes:r` to viewer, and `notes:rw` to all other operational
-- roles so anyone authenticated can read/write the logbook.
--
-- Run:
--   docker cp database/07-notes-all-roles.sql phoswatch-database:/tmp/n.sql
--   docker exec -i phoswatch-database psql -U phoswatch_user -d phoswatch_db -f /tmp/n.sql
-- ============================================================================

BEGIN;

-- viewer: read-only access to notes (was missing entirely)
UPDATE roles
   SET permissions = permissions || jsonb_build_object('notes', 'r')
 WHERE code = 'viewer'
   AND (permissions->>'notes' IS NULL);

-- operator / technician / supervisor: ensure full read+write
UPDATE roles
   SET permissions = permissions || jsonb_build_object('notes', 'rw')
 WHERE code IN ('operator', 'technician', 'supervisor');

-- admin already has {"*":"*"} so it's untouched.

COMMIT;

-- Sanity check
SELECT code, permissions->>'notes' AS notes_perm FROM roles ORDER BY code;
