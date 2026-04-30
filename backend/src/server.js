/**
 * Phoswatch backend entry point.
 *
 *   1. Wait for Postgres.
 *   2. Build Express app.
 *   3. Start HTTP server.
 *   4. Attach Socket.io with JWT handshake.
 *   5. Start live feeders (synthetic generator and/or OPC UA).
 */
'use strict';

const http = require('http');
const env = require('./config/env');
const logger = require('./config/logger');
const { waitForReady, pool } = require('./config/db');
const { buildApp } = require('./app');
const websocket = require('./services/websocket');
const dataGenerator = require('./services/dataGenerator');
const scada = require('./utils/scadaConnector');
const historicalBackfill = require('./services/historicalBackfill');
const predictionScheduler = require('./services/predictionScheduler');

async function main() {
  logger.info('phoswatch backend starting', { env: env.nodeEnv, port: env.port });

  await waitForReady();

  // Historical backfill — populate sensor_readings/alarms/predictions
  // from 15/04/2026 → NOW so dashboard, alarms history, and AI prediction
  // trend charts have real multi-week data on first boot. Idempotent.
  await historicalBackfill.run().catch((err) =>
    logger.warn('historical backfill skipped', { err: err.message })
  );

  const app = buildApp();
  const httpServer = http.createServer(app);

  const { emitter } = websocket.init(httpServer);

  httpServer.listen(env.port, () => {
    logger.info(`HTTP + WS listening on :${env.port}`);
  });

  // Start feeders after the server is up so readings start flowing immediately
  dataGenerator.start(emitter).catch((err) =>
    logger.error('data generator failed to start', { err: err.message })
  );
  scada.start(emitter).catch((err) =>
    logger.error('scada failed to start', { err: err.message })
  );

  // Auto-run anomaly + failure ML on a fixed cadence — no user clicks needed.
  predictionScheduler.start(emitter).catch((err) =>
    logger.error('prediction scheduler failed to start', { err: err.message })
  );

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`received ${signal}, shutting down`);
    dataGenerator.stop();
    predictionScheduler.stop();
    await scada.stop().catch(() => {});
    httpServer.close(() => logger.info('http server closed'));
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('fatal boot error', { err: err.message, stack: err.stack });
  process.exit(1);
});
