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

/**
 * Permission check against users.roles.permissions JSONB.
 * resource e.g. 'alarms', action e.g. 'r' (read), 'w' (write)
 * Values accepted: 'r', 'w', 'rw', '*', true.
 */
function requirePerm(resource, action = 'r') {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'Not authenticated'));
    const p = req.user.permissions?.[resource];
    if (p === '*' || p === true) return next();
    if (typeof p === 'string' && p.includes(action)) return next();
    next(new ApiError(403, `Requires permission: ${resource}:${action}`));
  };
}

module.exports = { signToken, authRequired, requireRole, requirePerm };
