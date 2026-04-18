/**
 * Authentication: login, /me, password change.
 * Users are validated against bcrypt-hashed `users.password_hash`.
 */
'use strict';

const bcrypt = require('bcrypt');
const { query } = require('../config/db');
const { signToken } = require('../middleware/auth');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const logger = require('../config/logger');

/**
 * POST /api/auth/login
 * body: { username, password }
 */
const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw new ApiError(400, 'username and password are required');

  const { rows } = await query(
    `SELECT u.user_id, u.username, u.email, u.full_name, u.password_hash,
            u.is_active, r.code AS role_code, r.permissions
     FROM users u
     JOIN roles r ON r.role_id = u.role_id
     WHERE u.username = $1`,
    [username]
  );
  const user = rows[0];
  if (!user || !user.is_active) throw new ApiError(401, 'Invalid credentials');

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new ApiError(401, 'Invalid credentials');

  await query('UPDATE users SET last_login = NOW() WHERE user_id = $1', [user.user_id]);

  const token = signToken(user);
  logger.info('login', { user: user.username, role: user.role_code });

  res.json({
    token,
    user: {
      id: user.user_id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      role: user.role_code,
      permissions: user.permissions,
    },
  });
});

/** GET /api/auth/me */
const me = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT u.user_id, u.username, u.email, u.full_name, r.code AS role_code, r.permissions
     FROM users u JOIN roles r ON r.role_id = u.role_id
     WHERE u.user_id = $1`,
    [req.user.id]
  );
  const u = rows[0];
  if (!u) throw new ApiError(404, 'User not found');
  res.json({
    id: u.user_id, username: u.username, email: u.email,
    fullName: u.full_name, role: u.role_code, permissions: u.permissions,
  });
});

/** POST /api/auth/change-password */
const changePassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword || newPassword.length < 8) {
    throw new ApiError(400, 'newPassword must be at least 8 chars');
  }
  const { rows } = await query(
    'SELECT password_hash FROM users WHERE user_id = $1', [req.user.id]);
  if (!rows[0]) throw new ApiError(404, 'User not found');
  if (!(await bcrypt.compare(oldPassword, rows[0].password_hash))) {
    throw new ApiError(401, 'Old password incorrect');
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await query('UPDATE users SET password_hash = $1 WHERE user_id = $2',
    [hash, req.user.id]);
  res.json({ ok: true });
});

module.exports = { login, me, changePassword };
