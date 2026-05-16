/**
 * alarmNotifier.js
 *
 * Fires two kinds of notification whenever a critical alarm is raised:
 *
 *  1. In-app DM  – inserted into `direct_messages` (kind='alert').
 *     Goes to the equipment's responsible user, or falls back to all
 *     active supervisors + admins if none is set.
 *
 *  2. Email alert – sent via SMTP (nodemailer) to:
 *       • The responsible user's registered email address (if set)
 *       • Every active operator and technician (since fatal alarms
 *         concern the whole floor team and there can be more than one)
 *     Only real external addresses (containing '@') are used; .local
 *     addresses are silently skipped when SMTP points to an external relay.
 *     Email is only sent when SMTP_ENABLED=true (see emailService.js).
 *
 * Severity gate: only `fatal`, `urgent`, and `critical` alarms trigger
 * notifications. Configurable via ALARM_NOTIFY_SEVERITIES env var.
 *
 * Dedup: same equipment + same severity fires at most once every 5 minutes
 * to avoid flooding inboxes during sustained alarm conditions.
 */
'use strict';

const { query }          = require('../config/db');
const logger             = require('../config/logger');
const { sendAlarmEmail } = require('./emailService');

const NOTIFY_SEVS = (process.env.ALARM_NOTIFY_SEVERITIES || 'fatal,urgent,critical')
  .split(',').map(s => s.trim()).filter(Boolean);

// Dedup map: key = `eqId:severity` → last-fired timestamp (ms)
const recentAlerts = new Map();
const DEDUP_MS = 5 * 60 * 1000;   // 5 minutes

/* The id of the system "alarm-bot" sender for in-app DMs. */
async function _systemSenderId() {
  const { rows } = await query(
    `SELECT user_id FROM users WHERE username = 'admin' OR user_id = 1
     ORDER BY user_id ASC LIMIT 1`);
  return rows[0]?.user_id || 1;
}

/**
 * Notify all relevant users (in-app DM + email) when a critical alarm fires.
 */
async function notifyCriticalAlarm(alarm) {
  try {
    const sev = String(alarm?.severity || '').toLowerCase();
    if (!NOTIFY_SEVS.includes(sev)) return;
    if (!alarm.equipment_id) return;

    // ── Dedup ──────────────────────────────────────────────────────────────
    const key  = `${alarm.equipment_id}:${sev}`;
    const last = recentAlerts.get(key) || 0;
    if (Date.now() - last < DEDUP_MS) return;
    recentAlerts.set(key, Date.now());

    // ── Equipment + sensor info ────────────────────────────────────────────
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

    // ── In-app DM recipients ───────────────────────────────────────────────
    // Primary: responsible user. Fallback: all active supervisors + admins.
    let dmRecipientIds = [];
    if (eq.responsible_user_id) {
      dmRecipientIds = [eq.responsible_user_id];
    } else {
      const { rows } = await query(
        `SELECT u.user_id FROM users u
         JOIN roles r ON r.role_id = u.role_id
         WHERE u.is_active = TRUE AND r.code IN ('admin','supervisor')`);
      dmRecipientIds = rows.map(r => r.user_id);
    }

    // ── Email recipients ───────────────────────────────────────────────────
    // Responsible user's email + every active operator and technician.
    // Using a UNION to get the full, deduplicated set of addresses.
    const { rows: emailRows } = await query(
      `SELECT DISTINCT u.email
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       WHERE u.is_active = TRUE
         AND (
           u.user_id = $1
           OR r.code IN ('operator', 'technician')
         )`,
      [eq.responsible_user_id || 0]
    );
    const emailAddresses = emailRows.map(r => r.email).filter(Boolean);

    // ── Send in-app DMs ────────────────────────────────────────────────────
    if (dmRecipientIds.length) {
      const sender    = await _systemSenderId();
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

      const targets = dmRecipientIds.filter(uid => uid !== sender);
      if (targets.length) {
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
        logger.info('critical alarm DM sent', {
          equipment: eq.tag_code, severity: sev, recipients: targets.length,
        });
      }
    }

    // ── Send email alerts ──────────────────────────────────────────────────
    // Fire-and-forget — email failure must never crash the alarm pipeline.
    sendAlarmEmail(alarm, eq, emailAddresses).catch(err =>
      logger.warn('alarm email fire-and-forget failed', { err: err.message })
    );

  } catch (err) {
    logger.warn('alarm notifier failed', { err: err.message });
  }
}

module.exports = { notifyCriticalAlarm };
