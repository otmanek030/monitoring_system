/**
 * Centralised environment loader.
 *
 * Loads .env (if present) and exports a validated config object.
 * Docker provides env vars directly, but the local .env makes
 * `npm run dev` work outside the container.
 */
'use strict';

require('dotenv').config();

function bool(v, def = false) {
  if (v === undefined || v === null) return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const env = {
  nodeEnv:   process.env.NODE_ENV || 'development',
  isProd:    (process.env.NODE_ENV || '').toLowerCase() === 'production',
  port:      num(process.env.PORT, 3000),

  databaseUrl: process.env.DATABASE_URL
    || 'postgresql://phoswatch_user:phoswatch_pass@database:5432/phoswatch_db',

  mlServiceUrl: process.env.ML_SERVICE_URL || 'http://ml-service:8000',

  jwtSecret:    process.env.JWT_SECRET     || 'phoswatch_dev_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',

  corsOrigin:   process.env.CORS_ORIGIN    || 'http://localhost',

  dataGenerator: {
    enabled:    bool(process.env.DATA_GENERATOR_ENABLED, true),
    intervalMs: num(process.env.DATA_GENERATOR_INTERVAL_MS, 1000),
  },

  opcua: {
    enabled:  bool(process.env.OPCUA_ENABLED, false),
    endpoint: process.env.OPCUA_ENDPOINT || '',
    username: process.env.OPCUA_USERNAME || '',
    password: process.env.OPCUA_PASSWORD || '',
  },

  rateLimit: {
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    max:      num(process.env.RATE_LIMIT_MAX,       300),
  },

  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = env;
