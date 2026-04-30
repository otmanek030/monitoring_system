/**
 * alarmNotifier.js
 *
 * Sends a direct message to the equipment's responsible user (and to any
 * supervisor / admin as a fallback) whenever a critical alarm fires.
 *
 * The message goes into `direct_messages` with kind='alert' so it shows
 * up in the Communication panel's Inbox with red highlighting and an
 * emergency icon. Recipients see it the next time they open the panel
 * (4 s polling) or instantly if they're already viewing the thread.
 *
 * Severity gate: only `fatal` and `urgent` alarms trigger a notification
 * (warnings are too noisy to DM about). Configurable via
 * ALARM_NOTIFY_SEVERITIES env var (comma-separated).
 */
'use strict';

const { query } = require('../config/db');
const logger = require('../config/logger');

const NOTIFY_SEVS = (process.env.ALARM_NOTIFY_SEVERITIES || 'fatal,urgent,critical')
  .split(',').map(s => s.trim()).filter(Boolean);

// Avoid spamming: same equipment + same severity within 5 minutes is one alert.
const recentAlerts = new Map();   // key=`eqId:severity` → timestamp ms
const DEDUP_MS = 5 * 60 * 1000;

/* The id of the system "alarm-bot" sender. We piggy-back on user_id=1
   (admin) so the message has a valid foreign key. The body makes it clear
   the message is automated. */
async function _systemSenderId() {
  const { rows } = await query(
    `SELECT user_id FROM users WHERE username = 'admin' OR user_id = 1
     ORDER BY user_id ASC LIMIT 1`);
  return rows[0]?.user_id || 1;
}

/**
 * Post a critical-alarm DM to the equipment's responsible user. If no
 * responsible user is set, fall back to all supervisors + admins so the
 * alert isn't lost.
 */
async function notifyCriticalAlarm(alarm) {
  try {
    const sev = String(alarm?.severity || '').toLowerCase();
    if (!NOTIFY_SEVS.includes(sev)) return;
    if (!alarm.equipment_id) return;

    // Dedup
    const key = `${alarm.equipment_id}:${sev}`;
    const last = recentAlerts.get(key) || 0;
    if (Date.now() - last < DEDUP_MS) return;
    recentAlerts.set(key, Date.now());

    // Pull equipment + responsible user + sensor info
    const { rows: eqRows } = await query(
      `SELECT e.equipment_id, e.tag_code, e.name, e.responsible_user_id,
              s.tag_code AS sensor_tag, s.name AS sensor_name, s.unit AS sensor_unit
       FROM equipment e
       LEFT JOIN sensors s ON s.sensor_id = $1
       WHERE e.equipment_id = $2
       LIMIT 1`,
      [alarm.sensor_id || null, alarm.equipment_id]
    );
    const eq = eqRows[0];
    if (!eq) return;

    // Pick recipients
    let recipients = [];
    if (eq.responsible_user_id) {
      recipients = [eq.responsible_user_id];
    } else {
      // Fallback: every active supervisor + admin
      const { rows } = await query(
        `SELECT u.user_id FROM users u
         JOIN roles r ON r.role_id = u.role_id
         WHERE u.is_active = TRUE AND r.code IN ('admin','supervisor')`);
      recipients = rows.map(r => r.user_id);
    }
    if (!recipients.length) return;

    const sender = await _systemSenderId();
    const triggerVal = alarm.trigger_value != null
      ? Number(alarm.trigger_value).toFixed(3)
      : '?';

    const body =
`Critical alarm on ${eq.tag_code} — ${eq.name}
Severity: ${sev.toUpperCase()}
Sensor:   ${eq.sensor_tag || '—'} ${eq.sensor_name ? `(${eq.sensor_name})` : ''}
Reading:  ${triggerVal} ${eq.sensor_unit || ''}
Message:  ${alarm.message || '—'}
Action:   Immediate inspection required. View in Alarms page.`;

    // Don't message the sender themselves
    const targets = recipients.filter(uid => uid !== sender);
    if (!targets.length) return;

    const values = [];
    const placeholders = targets.map((uid, i) => {
      const k = i * 5;
      values.push(sender, uid, body, 'alert', alarm.alarm_id || null);
      return `($${k+1}, $${k+2}, $${k+3}, $${k+4}, $${k+5})`;
    });
    await query(
      `INSERT INTO direct_messages
         (from_user_id, to_user_id, body, kind, ref_alarm_id)
       VALUES ${placeholders.join(',')}`,
      values
    );
    logger.info('critical alarm notification sent', {
      equipment: eq.tag_code, severity: sev, recipients: targets.length,
    });
  } catch (err) {
    logger.warn('alarm notifier failed', { err: err.message });
  }
}

module.exports = { notifyCriticalAlarm };
