/**
 * JWT authentication + RBAC middleware.
 *
 *   authRequired(req, res, next)      - verifies Bearer token, loads req.user
 *   requireRole('admin','supervisor') - guards an endpoint by role code
 *   requirePerm('alarms', 'w')        - checks roles.permissions JSON for r/w/*
 */
'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { ApiError } = require('./errorHandler');
const { query } = require('../config/db');

/* In-memory cache so we don't hit the DB on every request. Keyed by user_id;
   refreshed on a 60-second TTL. Fresh enough for permission edits to take
   effect quickly, cheap enough that 99.9% of requests skip the DB. */
const permsCache = new Map(); // user_id -> { perms, role, fetchedAt }
const PERMS_TTL_MS = 60_000;

function signToken(user) {
  return jwt.sign(
    {
      sub: user.user_id,
      username: user.username,
      role: user.role_code,
      permissions: user.permissions || {},
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

function authRequired(req, _res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return next(new ApiError(401, 'Missing Authorization Bearer token'));

  try {
    const payload = jwt.verify(m[1], env.jwtSecret);
    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions || {},
    };
    next();
  } catch (err) {
    next(new ApiError(401, 'Invalid or expired token'));
  }
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'Not authenticated'));
    if (roles.includes(req.user.role)) return next();
    next(new ApiError(403, `Requires role: ${roles.join(' | ')}`));
  };
}

function _checkPerms(perms, resource, action) {
  const star = perms['*'];
  if (star === '*' || star === true) return true;
  if (typeof star === 'string' && star.includes(action)) return true;
  const p = perms[resource];
  if (p === '*' || p === true) return true;
  if (typeof p === 'string' && p.includes(action)) return true;
  return false;
}

/**
 * Permission check against users.roles.permissions JSONB.
 * resource e.g. 'alarms', action e.g. 'r' (read), 'w' (write)
 * Values accepted: 'r', 'w', 'rw', '*', true.
 *
 * Fallback: if the JWT-encoded perms don't grant the request, we re-read
 * the role's permissions from the DB (60-s TTL cache). This lets newly
 * granted permissions take effect for already-logged-in users without
 * forcing them to log back in.
 */
function requirePerm(resource, action = 'r') {
  return async (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'Not authenticated'));

    // Fast path — JWT-cached perms
    if (_checkPerms(req.user.permissions || {}, resource, action)) return next();

    // Slow path — refresh from DB (handles permission grants that happened
    // after the user's JWT was issued).
    try {
      const cached = permsCache.get(req.user.id);
      let fresh = null;
      if (cached && Date.now() - cached.fetchedAt < PERMS_TTL_MS) {
        fresh = cached.perms;
      } else {
        const { rows } = await query(
          `SELECT r.permissions FROM users u
           JOIN roles r ON r.role_id = u.role_id
           WHERE u.user_id = $1`,
          [req.user.id]
        );
        if (rows[0]) {
          fresh = rows[0].permissions || {};
          permsCache.set(req.user.id, { perms: fresh, fetchedAt: Date.now() });
          // Update the request-scoped perms so downstream handlers see the new ones.
          req.user.permissions = fresh;
        }
      }
      if (fresh && _checkPerms(fresh, resource, action)) return next();
    } catch (err) {
      // DB lookup failure shouldn't open the door — fall through to 403.
    }

    next(new ApiError(403, `Requires permission: ${resource}:${action}`));
  };
}

module.exports = { signToken, authRequired, requireRole, requirePerm };
