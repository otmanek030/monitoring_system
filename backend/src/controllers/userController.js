/**
 * User management - admin only (except self via /me which is in authController).
 */
'use strict';

const bcrypt = require('bcrypt');
const { query } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

const list = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT u.user_id, u.username, u.email, u.full_name, u.is_active, u.last_login,
            r.code AS role
     FROM users u JOIN roles r ON r.role_id = u.role_id
     ORDER BY u.username`);
  res.json(rows);
});

const create = asyncHandler(async (req, res) => {
  const { username, email, full_name, password, role = 'operator' } = req.body || {};
  if (!username || !email || !password) throw new ApiError(400, 'username, email, password required');
  if (password.length < 8) throw new ApiError(400, 'password must be ≥ 8 chars');

  const { rows: roleRows } = await query('SELECT role_id FROM roles WHERE code = $1', [role]);
  if (!roleRows[0]) throw new ApiError(400, 'invalid role');

  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await query(
      `INSERT INTO users (username, email, full_name, password_hash, role_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING user_id, username, email, full_name`,
      [username, email, full_name || null, hash, roleRows[0].role_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'username or email already exists');
    throw err;
  }
});

const setActive = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE users SET is_active = $1 WHERE user_id = $2
     RETURNING user_id, username, is_active`,
    [!!req.body.is_active, req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'User not found');
  res.json(rows[0]);
});

const setRole = asyncHandler(async (req, res) => {
  const { role } = req.body || {};
  const { rows: r } = await query('SELECT role_id FROM roles WHERE code = $1', [role]);
  if (!r[0]) throw new ApiError(400, 'invalid role');
  const { rows } = await query(
    `UPDATE users SET role_id = $1 WHERE user_id = $2
     RETURNING user_id, username`, [r[0].role_id, req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'User not found');
  res.json({ ...rows[0], role });
});

const remove = asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM users WHERE user_id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'User not found');
  res.json({ ok: true });
});

module.exports = { list, create, setActive, setRole, remove };
