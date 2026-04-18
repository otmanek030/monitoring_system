/**
 * PostgreSQL connection pool (shared across the app).
 *
 * Exposes:
 *   - query(text, params) -> pg QueryResult
 *   - getClient()         -> pg client (for transactions; remember to release)
 *   - pool                -> the raw pool if needed
 *   - waitForReady()      -> resolves when the DB accepts connections
 */
'use strict';

const { Pool } = require('pg');
const env = require('./env');
const logger = require('./logger');

const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  logger.error('Unexpected Postgres pool error', { err: err.message });
});

async function query(text, params) {
  const started = Date.now();
  try {
    const res = await pool.query(text, params);
    const ms = Date.now() - started;
    if (ms > 250) {
      logger.warn('slow query', { ms, rows: res.rowCount, text: text.slice(0, 120) });
    }
    return res;
  } catch (err) {
    logger.error('query failed', { err: err.message, text: text.slice(0, 160) });
    throw err;
  }
}

async function getClient() {
  return pool.connect();
}

/**
 * Wait until the database is reachable. Used at boot so we don't crash
 * when Postgres is still initialising inside Docker.
 */
async function waitForReady({ retries = 30, delayMs = 2000 } = {}) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      logger.info('database ready');
      return true;
    } catch (err) {
      logger.warn(`database not ready (${i}/${retries}): ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('database did not become ready in time');
}

module.exports = { pool, query, getClient, waitForReady };
