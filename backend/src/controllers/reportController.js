/**
 * Report generation controller.
 * Delegates the actual file building to services/exporters.
 *
 *   GET /api/reports/equipment/:id/xlsx?from=&to=
 *   GET /api/reports/equipment/:id/pdf?from=&to=
 *   GET /api/reports/alarms/xlsx?from=&to=
 *   GET /api/reports/summary/pdf?from=&to=      (daily/weekly plant summary with AI insights)
 */
'use strict';

const exporters = require('../services/exporters');
const { query } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

function parseRange(q) {
  const to   = q.to   ? new Date(q.to)   : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
  if (isNaN(from) || isNaN(to) || from >= to) throw new ApiError(400, 'Invalid range');
  return { from, to };
}

const equipmentXlsx = asyncHandler(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const { rows: eq } = await query(
    `SELECT e.*, a.code AS area_code FROM equipment e
     JOIN areas a ON a.area_id = e.area_id WHERE equipment_id = $1`, [req.params.id]);
  if (!eq[0]) throw new ApiError(404, 'Equipment not found');

  const { rows: sensors } = await query(
    `SELECT sensor_id, tag_code, name, unit FROM sensors
     WHERE equipment_id = $1 AND is_active ORDER BY tag_code`, [req.params.id]);

  const dataBySensor = {};
  for (const s of sensors) {
    const { rows } = await query(
      `SELECT time_bucket('1 minute', ts) AS bucket,
              AVG(value) AS avg, MIN(value) AS min, MAX(value) AS max
       FROM sensor_readings
       WHERE sensor_id = $1 AND ts BETWEEN $2 AND $3
       GROUP BY bucket ORDER BY bucket`,
      [s.sensor_id, from, to]
    );
    dataBySensor[s.tag_code] = rows;
  }

  const { rows: alarms } = await query(
    `SELECT ts, severity, message, trigger_value FROM alarms
     WHERE equipment_id = $1 AND ts BETWEEN $2 AND $3
     ORDER BY ts DESC`, [req.params.id, from, to]);

  const buf = await exporters.buildEquipmentXlsx({
    equipment: eq[0], sensors, dataBySensor, alarms, from, to,
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${eq[0].tag_code}_report.xlsx"`);
  res.send(buf);
});

const equipmentPdf = asyncHandler(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const { rows: eq } = await query(
    `SELECT e.*, a.code AS area_code FROM equipment e
     JOIN areas a ON a.area_id = e.area_id WHERE equipment_id = $1`, [req.params.id]);
  if (!eq[0]) throw new ApiError(404, 'Equipment not found');

  const { rows: alarms } = await query(
    `SELECT ts, severity, message FROM alarms
     WHERE equipment_id = $1 AND ts BETWEEN $2 AND $3
     ORDER BY ts DESC LIMIT 200`, [req.params.id, from, to]);

  const { rows: rul } = await query(
    `SELECT ts, rul_hours, health_index FROM predictions_rul
     WHERE equipment_id = $1 ORDER BY ts DESC LIMIT 1`, [req.params.id]);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${eq[0].tag_code}_report.pdf"`);
  exporters.streamEquipmentPdf(res, {
    equipment: eq[0], alarms, rul: rul[0] || null, from, to,
  });
});

const alarmsXlsx = asyncHandler(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const { rows } = await query(
    `SELECT a.ts, a.cleared_ts, a.severity, a.message, a.trigger_value,
            e.tag_code AS equipment_tag, s.tag_code AS sensor_tag
     FROM alarms a
     JOIN equipment e ON e.equipment_id = a.equipment_id
     LEFT JOIN sensors s ON s.sensor_id = a.sensor_id
     WHERE a.ts BETWEEN $1 AND $2 ORDER BY a.ts DESC`,
    [from, to]);
  const buf = await exporters.buildAlarmsXlsx({ alarms: rows, from, to });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="alarms_report.xlsx"`);
  res.send(buf);
});

const summaryPdf = asyncHandler(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const { rows: eqHealth } = await query(
    `SELECT h.*, e.name FROM v_equipment_health h
     JOIN equipment e ON e.equipment_id = h.equipment_id
     ORDER BY health_index ASC NULLS LAST LIMIT 10`);

  const { rows: alarmsBySeverity } = await query(
    `SELECT severity, COUNT(*)::int AS n
     FROM alarms WHERE ts BETWEEN $1 AND $2 GROUP BY severity`,
    [from, to]);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="plant_summary.pdf"`);
  exporters.streamSummaryPdf(res, { eqHealth, alarmsBySeverity, from, to });
});

/**
 * GET /api/reports/my-shift/pdf?from=&to=
 * Per-user shift summary: the calling user's notes, the alarms raised in
 * the window, and the work orders assigned to them.
 *
 * Accessible to anyone with `my_shift:r`.
 */
const myShiftPdf = asyncHandler(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const uid = req.user.id;

  const { rows: u } = await query(
    `SELECT u.user_id, u.username, u.full_name, u.email, r.code AS role
     FROM users u JOIN roles r ON r.role_id = u.role_id
     WHERE u.user_id = $1`, [uid]);
  const user = u[0] || { username: req.user.username, role: req.user.role };

  // Notes the user wrote during the window
  const { rows: notes } = await query(
    `SELECT n.*, e.tag_code AS equipment_tag
     FROM operator_notes n
     LEFT JOIN equipment e ON e.equipment_id = n.equipment_id
     WHERE n.user_id = $1 AND n.created_at BETWEEN $2 AND $3
     ORDER BY n.created_at ASC`,
    [uid, from, to]);

  // All alarms raised in the window
  const { rows: alarms } = await query(
    `SELECT a.ts, a.severity, a.message, e.tag_code AS equipment_tag
     FROM alarms a
     JOIN equipment e ON e.equipment_id = a.equipment_id
     WHERE a.ts BETWEEN $1 AND $2
     ORDER BY a.ts ASC LIMIT 200`,
    [from, to]);

  // Work orders assigned to this user (open or touched in the window)
  const { rows: orders } = await query(
    `SELECT mo.*, e.tag_code AS equipment_tag
     FROM maintenance_orders mo
     JOIN equipment e ON e.equipment_id = mo.equipment_id
     WHERE mo.assigned_to = $1
       AND (mo.status <> 'completed'
            OR mo.created_at BETWEEN $2 AND $3)
     ORDER BY mo.priority DESC, mo.created_at DESC`,
    [uid, from, to]);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="shift_${user.username}_${from.toISOString().slice(0,10)}.pdf"`);
  exporters.streamShiftPdf(res, { user, notes, alarms, orders, from, to });
});

module.exports = { equipmentXlsx, equipmentPdf, alarmsXlsx, summaryPdf, myShiftPdf };
