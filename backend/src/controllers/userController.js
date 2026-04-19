/**
 * User management - admin only (except self via /me which is in authController).
 *
 * Rows are decorated with the short names the React Users page reads
 * (`id`, `last_login_at`) while keeping the raw DB columns (`user_id`,
 * `last_login`) for backwards-compat.
 */
'use strict';

const bcrypt = require('bcrypt');
const { query } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

/**
 * The built-in "admin" / System Administrator account is protected: no other
 * user — including other admins — is allowed to disable it, change its role,
 * or delete it. It can only modify itself via the self-service /me endpoints
 * (/api/auth/change-password). This protects against accidental lockouts and
 * raises the bar for an attacker that compromises a lower-tier admin.
 *
 * Detection: any user whose `user_id === 1` (first seeded row) OR whose
 * username matches a canonical seed name (case-insensitive).
 */
const PROTECTED_USERNAMES = new Set(['admin']);

function decorateUser(u) {
  if (!u) return u;
  const isProtected =
    u.user_id === 1 ||
    (u.username && PROTECTED_USERNAMES.has(String(u.username).toLowerCase()));
  return {
    ...u,
    id:            u.id            ?? u.user_id,
    last_login_at: u.last_login_at ?? u.last_login ?? null,
    protected:     !!isProtected,
  };
}

function parseId(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new ApiError(400, 'Invalid user id');
  return n;
}

async function assertNotProtected(id, actionLabel) {
  const { rows } = await query(
    'SELECT user_id, username FROM users WHERE user_id = $1', [id]);
  if (!rows[0]) throw new ApiError(404, 'User not found');
  const u = rows[0];
  const protectedId   = u.user_id === 1;
  const protectedName = PROTECTED_USERNAMES.has(String(u.username).toLowerCase());
  if (protectedId || protectedName) {
    throw new ApiError(
      403,
      `The System Administrator account is protected and cannot be ${actionLabel}.`
    );
  }
  return u;
}

const list = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT u.user_id, u.username, u.email, u.full_name, u.is_active,
            u.last_login,
            r.code AS role
     FROM users u JOIN roles r ON r.role_id = u.role_id
     ORDER BY u.username`);
  const items = rows.map(decorateUser);
  res.json({ items, users: items });   // both shapes for compatibility
});

const create = asyncHandler(async (req, res) => {
  const { username, email, full_name, password, role = 'operator' } = req.body || {};
  if (!username || !email || !password) throw new ApiError(400, 'username, email, password required');
  if (password.length < 8) throw new ApiError(400, 'password must be >= 8 chars');
  if (PROTECTED_USERNAMES.has(String(username).toLowerCase())) {
    throw new ApiError(409, 'That username is reserved for the System Administrator');
  }

  const { rows: roleRows } = await query('SELECT role_id FROM roles WHERE code = $1', [role]);
  if (!roleRows[0]) throw new ApiError(400, 'invalid role');

  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await query(
      `INSERT INTO users (username, email, full_name, password_hash, role_id)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING user_id, username, email, full_name, is_active, last_login`,
      [username, email, full_name || null, hash, roleRows[0].role_id]
    );
    res.status(201).json(decorateUser({ ...rows[0], role }));
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'username or email already exists');
    throw err;
  }
});

const setActive = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  await assertNotProtected(id, 'disabled or re-activated');
  const { rows } = await query(
    `UPDATE users SET is_active = $1 WHERE user_id = $2
     RETURNING user_id, username, is_active, last_login`,
    [!!req.body.is_active, id]
  );
  if (!rows[0]) throw new ApiError(404, 'User not found');
  res.json(decorateUser(rows[0]));
});

const setRole = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  await assertNotProtected(id, 'assigned a different role');
  const { role } = req.body || {};
  const { rows: r } = await query('SELECT role_id FROM roles WHERE code = $1', [role]);
  if (!r[0]) throw new ApiError(400, 'invalid role');
  const { rows } = await query(
    `UPDATE users SET role_id = $1 WHERE user_id = $2
     RETURNING user_id, username, is_active, last_login`,
    [r[0].role_id, id]);
  if (!rows[0]) throw new ApiError(404, 'User not found');
  res.json(decorateUser({ ...rows[0], role }));
});

const remove = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  await assertNotProtected(id, 'deleted');
  const { rowCount } = await query('DELETE FROM users WHERE user_id = $1', [id]);
  if (!rowCount) throw new ApiError(404, 'User not found');
  res.json({ ok: true, id });
});

module.exports = { list, create, setActive, setRole, remove };
