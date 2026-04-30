/**
 * Alarm endpoints.
 *
 * GET    /api/alarms          - list (filters: status=active|acknowledged|cleared|all,
 *                                      severity, equipment, from, to)
 * GET    /api/alarms/:id      - get one
 * POST   /api/alarms/:id/ack  - acknowledge
 * POST   /api/alarms/:id/clear
 * GET    /api/alarms/stats    - dashboard stats (counters + by severity + by area)
 *
 * For the React dashboard each row carries:
 *   id, status ('active'|'acknowledged'|'cleared'),
 *   opened_at, closed_at, acknowledged_at, severity, message, ...
 * The raw DB names (alarm_id / ts / cleared_ts) stay in the payload for
 * backwards-compatibility with older consumers.
 */
'use strict';

const { query } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

/** Add the short-name aliases the React dashboard expects. */
function decorateAlarm(a) {
  if (!a) return a;
  const status =
    a.cleared_ts     ? 'cleared' :
    a.acknowledged   ? 'acknowledged' :
                       'active';
  // The detail panel expects more fields than the raw SQL row carries.
  // We compute them here so the frontend doesn't have to:
  //   - rule_name        : derived from the alarm definition (state_to)
  //   - threshold_value  : the alarm definition threshold
  //   - sensor_value     : the value that triggered the alarm
  //   - acknowledged_by  : username of the acker (joined from users)
  //   - cleared_by       : not currently tracked → null for now
  //   - notes            : not currently tracked → null
  return {
    ...a,
    id:               a.id ?? a.alarm_id,
    status,
    opened_at:        a.opened_at ?? a.ts,
    closed_at:        a.closed_at ?? a.cleared_ts,
    rule_name:        a.rule_name
                       || (a.state_to
                           ? `${a.state_from || 'NORMAL'} → ${a.state_to}`
                           : null),
    threshold_value:  a.threshold_value ?? a.threshold ?? null,
    sensor_value:     a.sensor_value    ?? a.trigger_value ?? null,
    acknowledged_by:  a.acknowledged_by ?? a.acknowledged_by_username ?? null,
    cleared_by:       a.cleared_by      ?? null,
    notes:            a.notes           ?? null,
  };
}

const list = asyncHandler(async (req, res) => {
  const { status = 'active', severity, equipment, equipment_id,
          from, to, limit = 200 } = req.query;
  const where  = [];
  const params = [];

  // Status filter - 'all'/empty means no filter
  if (status === 'active')         where.push('a.cleared_ts IS NULL AND a.acknowledged = FALSE');
  else if (status === 'acknowledged') where.push('a.cleared_ts IS NULL AND a.acknowledged = TRUE');
  else if (status === 'cleared')   where.push('a.cleared_ts IS NOT NULL');

  if (severity)            { params.push(severity); where.push(`a.severity = $${params.length}`); }
  const eqParam = equipment_id || equipment;
  if (eqParam) {
    const eqInt = parseInt(eqParam, 10);
    if (Number.isFinite(eqInt)) {
      params.push(eqInt); where.push(`a.equipment_id = $${params.length}`);
    }
  }
  if (from) { params.push(new Date(from)); where.push(`a.ts >= $${params.length}`); }
  if (to)   { params.push(new Date(to));   where.push(`a.ts <= $${params.length}`); }
  params.push(Math.min(parseInt(limit, 10) || 200, 2000));

  const { rows } = await query(
    `SELECT a.alarm_id, a.ts, a.cleared_ts, a.severity, a.priority, a.message,
            a.trigger_value, a.state_from, a.state_to,
            a.acknowledged, a.acknowledged_at, a.equipment_id, a.sensor_id,
            e.tag_code AS equipment_tag, e.name AS equipment_name,
            s.tag_code AS sensor_tag, s.unit AS sensor_unit, s.measurement,
            u.username AS acknowledged_by_username,
            ad.threshold AS threshold_value, ad.code AS rule_code,
            ad.message_en AS rule_message_en
     FROM alarms a
     JOIN equipment e  ON e.equipment_id = a.equipment_id
     LEFT JOIN sensors s ON s.sensor_id = a.sensor_id
     LEFT JOIN users u   ON u.user_id  = a.acknowledged_by
     LEFT JOIN alarm_definitions ad ON ad.alarm_def_id = a.alarm_def_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.ts DESC
     LIMIT $${params.length}`,
    params
  );
  const items = rows.map(decorateAlarm);
  res.json({ items, count: items.length });
});

/* ───── Single alarm — full detail (used by /alarms/:id deep-link) ───── */
const getOne = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new ApiError(400, 'Invalid alarm id');
  const { rows } = await query(
    `SELECT a.alarm_id, a.ts, a.cleared_ts, a.severity, a.priority, a.message,
            a.trigger_value, a.state_from, a.state_to,
            a.acknowledged, a.acknowledged_at, a.equipment_id, a.sensor_id,
            e.tag_code AS equipment_tag, e.name AS equipment_name,
            s.tag_code AS sensor_tag, s.name AS sensor_name,
            s.unit AS sensor_unit, s.measurement,
            u.username AS acknowledged_by_username,
            ad.threshold AS threshold_value, ad.code AS rule_code,
            ad.message_en AS rule_message_en, ad.condition_type
     FROM alarms a
     JOIN equipment e  ON e.equipment_id = a.equipment_id
     LEFT JOIN sensors s ON s.sensor_id = a.sensor_id
     LEFT JOIN users u   ON u.user_id  = a.acknowledged_by
     LEFT JOIN alarm_definitions ad ON ad.alarm_def_id = a.alarm_def_id
     WHERE a.alarm_id = $1
     LIMIT 1`,
    [id]
  );
  if (!rows[0]) throw new ApiError(404, 'Alarm not found');
  res.json(decorateAlarm(rows[0]));
});

const stats = asyncHandler(async (_req, res) => {
  // Open alarms - split by severity
  const { rows: sev } = await query(
    `SELECT severity, COUNT(*)::int AS n
     FROM alarms WHERE cleared_ts IS NULL
     GROUP BY severity`);
  const by_severity = Object.fromEntries(sev.map(r => [r.severity, r.n]));

  // Count active vs acknowledged (both have cleared_ts IS NULL)
  const { rows: ackRows } = await query(
    `SELECT acknowledged, COUNT(*)::int AS n
     FROM alarms WHERE cleared_ts IS NULL
     GROUP BY acknowledged`);
  const active        = ackRows.filter(r => r.acknowledged === false).reduce((s, r) => s + r.n, 0);
  const acknowledged  = ackRows.filter(r => r.acknowledged === true ).reduce((s, r) => s + r.n, 0);
  const total_open    = active + acknowledged;

  const { rows: byArea } = await query(
    `SELECT ar.code AS area, COUNT(*)::int AS n
     FROM alarms a
     JOIN equipment e ON e.equipment_id = a.equipment_id
     JOIN areas ar    ON ar.area_id = e.area_id
     WHERE a.cleared_ts IS NULL
     GROUP BY ar.code ORDER BY ar.code`);

  res.json({
    active,
    acknowledged,
    total_open,
    by_severity,       // snake_case (frontend)
    bySeverity: by_severity, // camelCase (legacy)
    byArea,
  });
});

const ack = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new ApiError(400, 'Invalid alarm id');
  const { rows } = await query(
    `UPDATE alarms
     SET acknowledged = TRUE, acknowledged_by = $1, acknowledged_at = NOW()
     WHERE alarm_id = $2 AND cleared_ts IS NULL
     RETURNING alarm_id, ts, cleared_ts, acknowledged, acknowledged_at`,
    [req.user.id, id]
  );
  if (!rows[0]) throw new ApiError(404, 'Active alarm not found');
  res.json(decorateAlarm(rows[0]));
});

const clear = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw new ApiError(400, 'Invalid alarm id');
  const { rows } = await query(
    `UPDATE alarms SET cleared_ts = NOW()
     WHERE alarm_id = $1 AND cleared_ts IS NULL
     RETURNING alarm_id, ts, cleared_ts, acknowledged, acknowledged_at`,
    [id]
  );
  if (!rows[0]) throw new ApiError(404, 'Active alarm not found');
  res.json(decorateAlarm(rows[0]));
});

module.exports = { list, getOne, stats, ack, clear };
