/**
 * Higher-level DB helpers used by the data generator, alarm engine,
 * and WebSocket broadcaster.
 */
'use strict';

const { query } = require('../config/db');

/** Fetch all active sensors with their equipment ids - used by the feed loop. */
async function loadActiveSensors() {
  const { rows } = await query(
    `SELECT s.sensor_id, s.equipment_id, s.tag_code, s.name, s.measurement, s.unit,
            s.range_min, s.range_max,
            s.warn_low, s.warn_high, s.alarm_low, s.alarm_high,
            s.sampling_period_ms,
            e.tag_code AS equipment_tag, e.status AS equipment_status
     FROM sensors s
     JOIN equipment e ON e.equipment_id = s.equipment_id
     WHERE s.is_active = TRUE`
  );
  return rows;
}

/** Bulk insert readings (array of {sensor_id, ts, value}). */
async function insertReadings(rows) {
  if (!rows.length) return 0;
  const values = [];
  const ph = [];
  rows.forEach((r, i) => {
    const k = i * 4;
    ph.push(`($${k+1}, $${k+2}, $${k+3}, $${k+4})`);
    values.push(r.ts, r.sensor_id, r.value, r.quality ?? 192);
  });
  await query(
    `INSERT INTO sensor_readings (ts, sensor_id, value, quality)
     VALUES ${ph.join(',')}
     ON CONFLICT DO NOTHING`,
    values
  );
  return rows.length;
}

/** Active alarms count (dashboard badge). */
async function activeAlarmsCount() {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS n FROM alarms WHERE cleared_ts IS NULL');
  return rows[0].n;
}

module.exports = { loadActiveSensors, insertReadings, activeAlarmsCount };
