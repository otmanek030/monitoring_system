/**
 * Direct messages — internal communication between users.
 *
 * Anyone authenticated can:
 *   - list their own threads (people they've talked to)
 *   - send a message to any other active user
 *   - mark messages as read
 *
 * Critical alarms also generate `kind='alert'` messages addressed to the
 * equipment's responsible_user_id (see services/alarmNotifier.js).
 */
'use strict';

const { query } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

function decorate(m) {
  if (!m) return m;
  return {
    ...m,
    id:        m.id        ?? m.message_id,
    read:      !!m.read_at,
    fromName:  m.from_name  || m.from_username,
    fromRole:  m.from_role,
    toName:    m.to_name    || m.to_username,
    toRole:    m.to_role,
  };
}

/* GET /api/messages?with=USER_ID
   - if `with` is given → full conversation between me ↔ that user
   - otherwise         → my inbox (latest 200 messages addressed to me)        */
const list = asyncHandler(async (req, res) => {
  const me = req.user.id;
  const peer = req.query.with ? parseInt(req.query.with, 10) : null;

  if (peer && Number.isFinite(peer)) {
    const { rows } = await query(
      `SELECT m.message_id, m.body, m.kind, m.ref_alarm_id,
              m.created_at, m.read_at,
              m.from_user_id, m.to_user_id,
              fu.username AS from_username, fu.full_name AS from_name, fr.code AS from_role,
              tu.username AS to_username,   tu.full_name AS to_name,   tr.code AS to_role
       FROM direct_messages m
       JOIN users fu ON fu.user_id = m.from_user_id
       JOIN roles fr ON fr.role_id = fu.role_id
       JOIN users tu ON tu.user_id = m.to_user_id
       JOIN roles tr ON tr.role_id = tu.role_id
       WHERE (m.from_user_id = $1 AND m.to_user_id = $2)
          OR (m.from_user_id = $2 AND m.to_user_id = $1)
       ORDER BY m.created_at ASC
       LIMIT 500`,
      [me, peer]
    );
    res.json({ items: rows.map(decorate) });
    return;
  }

  const { rows } = await query(
    `SELECT m.message_id, m.body, m.kind, m.ref_alarm_id,
            m.created_at, m.read_at,
            m.from_user_id, m.to_user_id,
            fu.username AS from_username, fu.full_name AS from_name, fr.code AS from_role,
            tu.username AS to_username,   tu.full_name AS to_name,   tr.code AS to_role
     FROM direct_messages m
     JOIN users fu ON fu.user_id = m.from_user_id
     JOIN roles fr ON fr.role_id = fu.role_id
     JOIN users tu ON tu.user_id = m.to_user_id
     JOIN roles tr ON tr.role_id = tu.role_id
     WHERE m.to_user_id = $1 OR m.from_user_id = $1
     ORDER BY m.created_at DESC
     LIMIT 200`,
    [me]
  );
  res.json({ items: rows.map(decorate) });
});

/* GET /api/messages/threads
   List of every user the current user has exchanged messages with,
   with the last message preview + unread count. */
const threads = asyncHandler(async (req, res) => {
  const me = req.user.id;
  const { rows } = await query(
    `WITH conv AS (
       SELECT
         CASE WHEN from_user_id = $1 THEN to_user_id ELSE from_user_id END AS peer_id,
         MAX(created_at) AS last_ts
       FROM direct_messages
       WHERE from_user_id = $1 OR to_user_id = $1
       GROUP BY peer_id
     )
     SELECT u.user_id        AS peer_id,
            u.username       AS peer_username,
            u.full_name      AS peer_name,
            r.code           AS peer_role,
            c.last_ts,
            (SELECT COUNT(*)::int FROM direct_messages m
              WHERE m.to_user_id = $1 AND m.from_user_id = u.user_id
                AND m.read_at IS NULL) AS unread,
            (SELECT body FROM direct_messages m
              WHERE (m.from_user_id = $1 AND m.to_user_id = u.user_id)
                 OR (m.to_user_id   = $1 AND m.from_user_id = u.user_id)
              ORDER BY m.created_at DESC LIMIT 1)            AS last_body
     FROM conv c
     JOIN users u ON u.user_id = c.peer_id
     JOIN roles r ON r.role_id = u.role_id
     ORDER BY c.last_ts DESC`,
    [me]
  );
  res.json({ items: rows });
});

/* GET /api/messages/unread — just the count, for the floating widget badge */
const unreadCount = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM direct_messages
     WHERE to_user_id = $1 AND read_at IS NULL`, [req.user.id]);
  res.json({ count: rows[0].n });
});

/* POST /api/messages  body: { to_user_id, body, kind?, ref_alarm_id? } */
const send = asyncHandler(async (req, res) => {
  const to = parseInt(req.body?.to_user_id, 10);
  const body = String(req.body?.body || '').trim();
  if (!Number.isFinite(to))    throw new ApiError(400, 'to_user_id required');
  if (!body)                    throw new ApiError(400, 'body required');
  if (to === req.user.id)       throw new ApiError(400, 'cannot send to yourself');

  // Ensure recipient exists and is active
  const { rows: u } = await query(
    'SELECT user_id, is_active FROM users WHERE user_id = $1', [to]);
  if (!u[0] || !u[0].is_active) throw new ApiError(404, 'recipient not found or inactive');

  const kind = ['chat','alert','system'].includes(req.body?.kind) ? req.body.kind : 'chat';
  const refAlarm = req.body?.ref_alarm_id ? parseInt(req.body.ref_alarm_id, 10) : null;

  const { rows } = await query(
    `INSERT INTO direct_messages (from_user_id, to_user_id, body, kind, ref_alarm_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING message_id, body, kind, ref_alarm_id, created_at, read_at,
               from_user_id, to_user_id`,
    [req.user.id, to, body, kind, refAlarm]
  );

  res.status(201).json(decorate(rows[0]));
});

/* PATCH /api/messages/read  body: { peer_user_id }
   Mark all unread messages from `peer_user_id` to me as read.            */
const markRead = asyncHandler(async (req, res) => {
  const peer = parseInt(req.body?.peer_user_id, 10);
  if (!Number.isFinite(peer)) throw new ApiError(400, 'peer_user_id required');
  const { rowCount } = await query(
    `UPDATE direct_messages SET read_at = NOW()
     WHERE to_user_id = $1 AND from_user_id = $2 AND read_at IS NULL`,
    [req.user.id, peer]
  );
  res.json({ ok: true, updated: rowCount });
});

module.exports = { list, threads, unreadCount, send, markRead };
