/**
 * emailService.js
 *
 * Thin nodemailer wrapper used by alarmNotifier to send HTML alert emails.
 *
 * Configuration is driven entirely by env vars (see env.js / docker-compose):
 *   SMTP_ENABLED  – set to "true" to activate (default: false)
 *   SMTP_HOST     – e.g. smtp.gmail.com
 *   SMTP_PORT     – 587 (STARTTLS) or 465 (SSL)
 *   SMTP_SECURE   – "true" only for port 465
 *   SMTP_USER     – your Gmail / SMTP account
 *   SMTP_PASS     – Gmail App Password (16 chars, no spaces)
 *   SMTP_FROM     – display name + address, e.g. "PhosWatch Alerts <you@gmail.com>"
 *
 * Gmail quick-start:
 *   1. Enable 2-Step Verification on your Google Account.
 *   2. Go to Google Account → Security → App passwords.
 *   3. Create a new app password (name it "PhosWatch").
 *   4. Paste the 16-char password into SMTP_PASS in docker-compose.yml.
 *   5. Set SMTP_ENABLED=true and restart the backend container.
 */
'use strict';

const nodemailer = require('nodemailer');
const env        = require('../config/env');
const logger     = require('../config/logger');

// Build the transporter once at module load.
// If email is disabled the transporter is null and every send is a no-op.
let _transporter = null;

if (env.email.enabled) {
  _transporter = nodemailer.createTransport({
    host:   env.email.host,
    port:   env.email.port,
    secure: env.email.secure,
    auth: {
      user: env.email.user,
      pass: env.email.pass,
    },
  });
  logger.info('email service initialised', {
    host: env.email.host,
    port: env.email.port,
    user: env.email.user,
  });
} else {
  logger.info('email service disabled (SMTP_ENABLED != true)');
}

/**
 * Build an HTML email body for a critical alarm.
 */
function _buildHtml(alarm, eq) {
  const sev   = String(alarm.severity || '').toUpperCase();
  const color = sev === 'FATAL' ? '#c0392b' : '#e67e22';
  const val   = alarm.trigger_value != null
    ? Number(alarm.trigger_value).toFixed(3)
    : '—';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:8px;overflow:hidden;
                    box-shadow:0 2px 8px rgba(0,0,0,.12);">

        <!-- Header -->
        <tr>
          <td style="background:${color};padding:24px 32px;">
            <h1 style="margin:0;color:#fff;font-size:22px;letter-spacing:.5px;">
              ⚠️ PhosWatch — ${sev} Alarm
            </h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:13px;">
              Immediate attention required
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="border-collapse:collapse;font-size:14px;color:#2c3e50;">
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #ecf0f1;
                           font-weight:bold;width:40%;">Equipment</td>
                <td style="padding:8px 0;border-bottom:1px solid #ecf0f1;">
                  ${eq.tag_code} — ${eq.name}
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #ecf0f1;font-weight:bold;">
                  Severity</td>
                <td style="padding:8px 0;border-bottom:1px solid #ecf0f1;
                           color:${color};font-weight:bold;">${sev}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #ecf0f1;font-weight:bold;">
                  Sensor</td>
                <td style="padding:8px 0;border-bottom:1px solid #ecf0f1;">
                  ${eq.sensor_tag || '—'}${eq.sensor_name ? ' (' + eq.sensor_name + ')' : ''}
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #ecf0f1;font-weight:bold;">
                  Reading</td>
                <td style="padding:8px 0;border-bottom:1px solid #ecf0f1;">
                  <strong>${val}</strong> ${eq.sensor_unit || ''}
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #ecf0f1;font-weight:bold;">
                  Message</td>
                <td style="padding:8px 0;border-bottom:1px solid #ecf0f1;">
                  ${alarm.message || '—'}
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-weight:bold;">Timestamp</td>
                <td style="padding:8px 0;">
                  ${new Date(alarm.ts || Date.now()).toISOString().replace('T', ' ').slice(0, 19)} UTC
                </td>
              </tr>
            </table>

            <div style="margin-top:24px;padding:16px;background:#fef9e7;
                        border-left:4px solid ${color};border-radius:4px;">
              <strong style="color:${color};">Action required:</strong>
              Perform an immediate inspection of the equipment listed above.
              Log in to the PhosWatch dashboard for full details and to acknowledge this alarm.
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#ecf0f1;padding:16px 32px;
                     font-size:12px;color:#7f8c8d;text-align:center;">
            This is an automated alert from PhosWatch — OCP Benguerir Monitoring System.<br>
            Do not reply to this email.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Send a critical-alarm email to one or more addresses.
 *
 * @param {object}   alarm  - alarm row from the database
 * @param {object}   eq     - equipment+sensor info row
 * @param {string[]} emails - recipient list (falsy addresses are filtered out)
 * @returns {Promise<void>}
 */
async function sendAlarmEmail(alarm, eq, emails) {
  if (!_transporter) return;   // email disabled

  const recipients = [...new Set(emails.filter(e => e && e.includes('@')))];
  if (!recipients.length) return;

  const sev     = String(alarm.severity || '').toUpperCase();
  const subject = `[${sev}] PhosWatch Alarm — ${eq.tag_code}: ${eq.name}`;

  try {
    await _transporter.sendMail({
      from:    env.email.from,
      to:      recipients.join(', '),
      subject,
      html:    _buildHtml(alarm, eq),
      text:
        `${sev} alarm on ${eq.tag_code} — ${eq.name}\n` +
        `Sensor: ${eq.sensor_tag || '—'} ${eq.sensor_name || ''}\n` +
        `Reading: ${alarm.trigger_value != null ? Number(alarm.trigger_value).toFixed(3) : '—'} ${eq.sensor_unit || ''}\n` +
        `Message: ${alarm.message || '—'}\n` +
        `Time: ${new Date(alarm.ts || Date.now()).toISOString()}\n\n` +
        `Immediate inspection required.`,
    });
    logger.info('alarm email sent', { subject, recipients: recipients.length });
  } catch (err) {
    logger.warn('alarm email failed', { err: err.message });
  }
}

module.exports = { sendAlarmEmail };
