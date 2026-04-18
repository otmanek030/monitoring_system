/**
 * Alarm endpoints.
 *
 * GET    /api/alarms          - list (filters: status=active|all, severity, equipment, from, to)
 * GET    /api/alarms/:id      - get one
 * POST   /api/alarms/:id/ack  - acknowledge
 * POST   /api/alarms/:id/clear
 * GET    /api/alarms/stats    - dashboard stats (by severity, by area)
 */
'use strict';

const { query } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

const list = asyncHandler(async (req, res) => {
  const { status = 'active', severity, equipment, from, to, limit = 200 } = req.query;
  const where = [];
  const params = [];

  if (status === 'active')    where.push('a.cleared_ts IS NULL');
  else if (status === 'cleared') where.push('a.cleared_ts IS NOT NULL');
  if (severity)  { params.push(severity);  where.push(`a.severity = $${params.length}`); }
  if (equipment) { params.push(equipment); where.push(`a.equipment_id = $${params.length}`); }
  if (from)      { params.push(new Date(from)); where.push(`a.ts >= $${params.length}`); }
  if (to)        { params.push(new Date(to));   where.push(`a.ts <= $${params.length}`); }
  params.push(Math.min(parseInt(limit, 10) || 200, 2000));

  const { rows } = await query(
    `SELECT a.alarm_id, a.ts, a.cleared_ts, a.severity, a.priority, a.message,
            a.trigger_value, a.state_from, a.state_to,
            a.acknowledged, a.acknowledged_at,
            e.tag_code AS equipment_tag, e.name AS equipment_name,
            s.tag_code AS sensor_tag, s.unit AS sensor_unit,
            u.username AS acknowledged_by_username
     FROM alarms a
     JOIN equipment e  ON e.equipment_id = a.equipment_id
     LEFT JOIN sensors s ON s.sensor_id = a.sensor_id
     LEFT JOIN users u   ON u.user_id  = a.acknowledged_by
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.ts DESC
     LIMIT $${params.length}`,
    params
  );
  res.json(rows);
});

const stats = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT severity, COUNT(*)::int AS n
     FROM alarms WHERE cleared_ts IS NULL GROUP BY severity`);
  const bySeverity = Object.fromEntries(rows.map(r => [r.severity, r.n]));

  const { rows: byArea } = await query(
    `SELECT ar.code AS area, COUNT(*)::int AS n
     FROM alarms a
     JOIN equipment e ON e.equipment_id = a.equipment_id
     JOIN areas ar    ON ar.area_id = e.area_id
     WHERE a.cleared_ts IS NULL
     GROUP BY ar.code ORDER BY ar.code`);

  res.json({ bySeverity, byArea });
});

const ack = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await query(
    `UPDATE alarms
     SET acknowledged = TRUE, acknowledged_by = $1, acknowledged_at = NOW()
     WHERE alarm_id = $2 AND cleared_ts IS NULL
     RETURNING alarm_id, ts, acknowledged, acknowledged_at`,
    [req.user.id, id]
  );
  if (!rows[0]) throw new ApiError(404, 'Active alarm not found');
  res.json(rows[0]);
});

const clear = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await query(
    `UPDATE alarms SET cleared_ts = NOW()
     WHERE alarm_id = $1 AND cleared_ts IS NULL
     RETURNING alarm_id, ts, cleared_ts`,
    [id]
  );
  if (!rows[0]) throw new ApiError(404, 'Active alarm not found');
  res.json(rows[0]);
});

module.exports = { list, stats, ack, clear };
