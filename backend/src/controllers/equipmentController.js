/**
 * Equipment CRUD and health endpoints.
 *
 * The SQL columns (equipment_id, tag_code, warn_low, ...) are kept in the
 * response for backwards-compat, but we additionally alias them to the
 * shorter names the React frontend expects (id, tag, l1/l2/h1/h2) so a
 * single payload works for both clients.
 */
'use strict';

const { query } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

/* --------------------------------------------------------------------- *
 * Small helper: normalise sensor rows so the frontend always sees
 * { id, tag, l1, l2, h1, h2 } alongside the underlying DB names.
 * --------------------------------------------------------------------- */
function decorateSensor(s) {
  if (!s) return s;
  return {
    ...s,
    id:  s.id  ?? s.sensor_id,
    tag: s.tag ?? s.tag_code,
    l1:  s.l1  ?? (s.warn_low  != null ? Number(s.warn_low)  : null),
    l2:  s.l2  ?? (s.alarm_low != null ? Number(s.alarm_low) : null),
    h1:  s.h1  ?? (s.warn_high != null ? Number(s.warn_high) : null),
    h2:  s.h2  ?? (s.alarm_high!= null ? Number(s.alarm_high): null),
  };
}

function decorateEquipment(e) {
  if (!e) return e;
  return {
    ...e,
    id:           e.id           ?? e.equipment_id,
    tag:          e.tag          ?? e.tag_code,
    type_name:    e.type_name    ?? e.type_code,
    // health_index is 0..1 in the view, the UI wants 0..100
    health_score: e.health_score ?? (e.health_index != null ? Math.round(Number(e.health_index) * 100) : null),
  };
}

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
            t.code AS type_code, t.name AS type_name, t.category,
            a.code AS area_code, a.name AS area_name,
            COALESCE(h.health_index, 1.0) AS health_index
     FROM equipment e
     JOIN equipment_types t ON t.type_id = e.type_id
     JOIN areas a           ON a.area_id = e.area_id
     LEFT JOIN v_equipment_health h ON h.equipment_id = e.equipment_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.code, e.tag_code`,
    params
  );
  const items = rows.map(decorateEquipment);
  // Return both shapes so {items:[]}-style and []-style consumers work.
  res.json({ items, equipment: items });
});

/** GET /api/equipment/:id - includes the sensor list for the detail page */
const get = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new ApiError(400, 'Invalid equipment id');

  const { rows } = await query(
    `SELECT e.*, t.code AS type_code, t.name AS type_name, t.category,
            a.code AS area_code, a.name AS area_name,
            COALESCE(h.health_index, 1.0) AS health_index
     FROM equipment e
     JOIN equipment_types t ON t.type_id = e.type_id
     JOIN areas a ON a.area_id = e.area_id
     LEFT JOIN v_equipment_health h ON h.equipment_id = e.equipment_id
     WHERE e.equipment_id = $1`,
    [id]
  );
  if (!rows[0]) throw new ApiError(404, 'Equipment not found');

  const { rows: sensors } = await query(
    `SELECT sensor_id, tag_code, name, measurement, unit, opc_node_id,
            sampling_period_ms, range_min, range_max,
            warn_low, warn_high, alarm_low, alarm_high, is_active
     FROM sensors
     WHERE equipment_id = $1 AND is_active = TRUE
     ORDER BY tag_code`,
    [id]
  );

  res.json({
    ...decorateEquipment(rows[0]),
    sensors: sensors.map(decorateSensor),
  });
});

/** GET /api/equipment/:id/sensors */
const listSensors = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new ApiError(400, 'Invalid equipment id');

  const { rows } = await query(
    `SELECT sensor_id, tag_code, name, measurement, unit, opc_node_id,
            sampling_period_ms, range_min, range_max,
            warn_low, warn_high, alarm_low, alarm_high, is_active
     FROM sensors
     WHERE equipment_id = $1 AND is_active = TRUE
     ORDER BY tag_code`,
    [id]
  );
  res.json(rows.map(decorateSensor));
});

/**
 * GET /api/equipment/health   - dashboard card list + featured sensors
 *
 * The React dashboard expects `health.equipment[]`, so we wrap the array.
 * We also embed one representative sensor per asset so the dashboard can
 * render a live chart without a second round-trip.
 */
const healthOverview = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT h.equipment_id, h.tag_code, h.name, h.status, h.criticality,
            h.health_index, h.rul_hours, h.health_ts,
            a.code AS area_code,
            t.code AS type_code, t.name AS type_name,
            (SELECT COUNT(*)::int FROM alarms al
               WHERE al.equipment_id = h.equipment_id AND al.cleared_ts IS NULL) AS active_alarms
     FROM v_equipment_health h
     JOIN equipment e ON e.equipment_id = h.equipment_id
     JOIN areas a     ON a.area_id = e.area_id
     JOIN equipment_types t ON t.type_id = e.type_id
     ORDER BY h.health_index ASC NULLS LAST, a.code`
  );

  // Pull a couple of representative sensors per piece of equipment so the
  // Dashboard can show live charts straight from /equipment/health.
  const eqIds = rows.map(r => r.equipment_id);
  let sensorsByEq = new Map();
  if (eqIds.length) {
    const { rows: sens } = await query(
      `SELECT sensor_id, equipment_id, tag_code, name, measurement, unit,
              warn_low, warn_high, alarm_low, alarm_high
       FROM sensors
       WHERE equipment_id = ANY($1::int[]) AND is_active = TRUE
       ORDER BY tag_code`,
      [eqIds]
    );
    for (const s of sens) {
      const list = sensorsByEq.get(s.equipment_id) || [];
      list.push(decorateSensor(s));
      sensorsByEq.set(s.equipment_id, list);
    }
  }

  const equipment = rows.map(r => ({
    ...decorateEquipment(r),
    sensors: sensorsByEq.get(r.equipment_id) || [],
  }));

  res.json({
    equipment,
    count: equipment.length,
    avg_health: equipment.length
      ? equipment.reduce((s, e) => s + Number(e.health_score || 0), 0) / equipment.length
      : null,
  });
});

/** PATCH /api/equipment/:id/status  body { status } */
const setStatus = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new ApiError(400, 'Invalid equipment id');

  const allowed = ['running', 'idle', 'stopped', 'maintenance', 'fault'];
  const { status } = req.body || {};
  if (!allowed.includes(status)) throw new ApiError(400, 'Invalid status');
  const { rows } = await query(
    `UPDATE equipment SET status = $1, updated_at = NOW()
     WHERE equipment_id = $2
     RETURNING equipment_id, tag_code, status`,
    [status, id]
  );
  if (!rows[0]) throw new ApiError(404, 'Equipment not found');
  // audit log
  await query(
    `INSERT INTO events (ts, category, equipment_id, user_id, severity, message,
                         old_value, new_value, source)
     VALUES (NOW(), 'Controls', $1, $2, 'info', 'Equipment status changed',
             NULL, $3, 'API')`,
    [id, req.user?.id || null, status]
  );
  res.json({ ...rows[0], id: rows[0].equipment_id, tag: rows[0].tag_code });
});

module.exports = { list, get, listSensors, healthOverview, setStatus };
