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

async function main() {
  logger.info('phoswatch backend starting', { env: env.nodeEnv, port: env.port });

  await waitForReady();

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

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`received ${signal}, shutting down`);
    dataGenerator.stop();
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
