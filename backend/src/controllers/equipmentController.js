/**
 * Equipment CRUD and health endpoints.
 */
'use strict';

const { query } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

/** GET /api/equipment */
const list = asyncHandler(async (req, res) => {
  const { area, status, search } = req.query;
  const where = [];
  const params = [];
  if (area)   { params.push(area);         where.push(`a.code = $${params.length}`); }
  if (status) { params.push(status);       where.push(`e.status = $${params.length}`); }
  if (search) { params.push(`%${search}%`); where.push(`(e.tag_code ILIKE $${params.length} OR e.name ILIKE $${params.length})`); }

  const { rows } = await query(
    `SELECT e.equipment_id, e.tag_code, e.name, e.description, e.status,
            e.criticality, e.runtime_hours, e.expected_life_hours,
            t.code AS type_code, t.category, a.code AS area_code, a.name AS area_name
     FROM equipment e
     JOIN equipment_types t ON t.type_id = e.type_id
     JOIN areas a           ON a.area_id = e.area_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.code, e.tag_code`,
    params
  );
  res.json(rows);
});

/** GET /api/equipment/:id */
const get = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT e.*, t.code AS type_code, t.category, a.code AS area_code, a.name AS area_name
     FROM equipment e
     JOIN equipment_types t ON t.type_id = e.type_id
     JOIN areas a ON a.area_id = e.area_id
     WHERE e.equipment_id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Equipment not found');
  res.json(rows[0]);
});

/** GET /api/equipment/:id/sensors */
const listSensors = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT sensor_id, tag_code, name, measurement, unit, opc_node_id,
            sampling_period_ms, range_min, range_max,
            warn_low, warn_high, alarm_low, alarm_high, is_active
     FROM sensors
     WHERE equipment_id = $1 AND is_active = TRUE
     ORDER BY tag_code`,
    [req.params.id]
  );
  res.json(rows);
});

/** GET /api/equipment/health  - dashboard card list */
const healthOverview = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT h.*, a.code AS area_code,
            (SELECT COUNT(*)::int FROM alarms al
               WHERE al.equipment_id = h.equipment_id AND al.cleared_ts IS NULL) AS active_alarms
     FROM v_equipment_health h
     JOIN equipment e ON e.equipment_id = h.equipment_id
     JOIN areas a     ON a.area_id = e.area_id
     ORDER BY h.health_index ASC NULLS LAST, a.code`
  );
  res.json(rows);
});

/** PATCH /api/equipment/:id/status  body { status } */
const setStatus = asyncHandler(async (req, res) => {
  const allowed = ['running', 'idle', 'stopped', 'maintenance', 'fault'];
  const { status } = req.body || {};
  if (!allowed.includes(status)) throw new ApiError(400, 'Invalid status');
  const { rows } = await query(
    `UPDATE equipment SET status = $1, updated_at = NOW()
     WHERE equipment_id = $2
     RETURNING equipment_id, tag_code, status`,
    [status, req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Equipment not found');
  // audit log
  await query(
    `INSERT INTO events (ts, category, equipment_id, user_id, severity, message,
                         old_value, new_value, source)
     VALUES (NOW(), 'Controls', $1, $2, 'info', 'Equipment status changed',
             NULL, $3, 'API')`,
    [req.params.id, req.user?.id || null, status]
  );
  res.json(rows[0]);
});

module.exports = { list, get, listSensors, healthOverview, setStatus };
