/**
 * Threshold-based alarm engine.
 *
 * For each incoming reading we compare it against warn_low / warn_high
 * / alarm_low / alarm_high on the sensor and create an alarm row if the
 * state transitions from Normal -> L1/L2/H1/H2.  Hysteresis-free MVP:
 * we clear the alarm when the value returns inside the band.
 *
 * Emits (via the provided emitter) 'alarm:new' and 'alarm:cleared' events
 * that the WebSocket layer forwards to connected clients.
 */
'use strict';

const { query } = require('../config/db');
const logger = require('../config/logger');

// In-memory last-state per sensor to detect transitions without hitting DB.
const lastState = new Map(); // sensor_id -> { state, alarmId }

function classify(value, s) {
  if (s.alarm_high != null && value >= Number(s.alarm_high)) return { code: 'H2_ALARM',   sev: 'fatal',   state: 'H2' };
  if (s.warn_high  != null && value >= Number(s.warn_high))  return { code: 'H1_WARNING', sev: 'warning', state: 'H1' };
  if (s.alarm_low  != null && value <= Number(s.alarm_low))  return { code: 'L2_ALARM',   sev: 'fatal',   state: 'L2' };
  if (s.warn_low   != null && value <= Number(s.warn_low))   return { code: 'L1_WARNING', sev: 'warning', state: 'L1' };
  return { state: 'NORMAL' };
}

/**
 * Evaluate one reading. Returns an array of change events to broadcast.
 *   {type:'new',     alarm:{...}}  or
 *   {type:'cleared', alarm_id}
 */
async function evaluate(sensor, value, ts) {
  const now = classify(value, sensor);
  const prev = lastState.get(sensor.sensor_id) || { state: 'NORMAL' };
  const events = [];

  if (prev.state === now.state) return events;

  // Clear previous alarm (if it was not NORMAL)
  if (prev.alarmId) {
    try {
      await query(
        `UPDATE alarms SET cleared_ts = $1 WHERE alarm_id = $2 AND cleared_ts IS NULL`,
        [ts, prev.alarmId]
      );
      events.push({ type: 'cleared', alarm_id: prev.alarmId });
    } catch (err) {
      logger.error('alarm clear failed', { err: err.message });
    }
  }

  // Raise new alarm (unless we just returned to NORMAL)
  if (now.state !== 'NORMAL') {
    try {
      const { rows } = await query(
        `INSERT INTO alarms
           (ts, alarm_def_id, equipment_id, sensor_id,
            severity, priority, message, trigger_value, state_from, state_to)
         SELECT $1,
                (SELECT alarm_def_id FROM alarm_definitions
                  WHERE sensor_id = $2 AND code = $3 LIMIT 1),
                s.equipment_id, s.sensor_id,
                $4, $5,
                s.name || ' ' || $3 || ' (' || $6 || ' ' || s.unit || ')',
                $6, $7, $8
         FROM sensors s WHERE s.sensor_id = $2
         RETURNING alarm_id, ts, equipment_id, sensor_id, severity, message, trigger_value`,
        [ts, sensor.sensor_id, now.code, now.sev,
         now.sev === 'fatal' ? 1 : 3, value, prev.state, now.state]
      );
      if (rows[0]) {
        events.push({ type: 'new', alarm: rows[0] });
        lastState.set(sensor.sensor_id, { state: now.state, alarmId: rows[0].alarm_id });
        return events;
      }
    } catch (err) {
      logger.error('alarm insert failed', { err: err.message });
    }
  }

  lastState.set(sensor.sensor_id, { state: now.state, alarmId: null });
  return events;
}

module.exports = { evaluate, _lastState: lastState };
