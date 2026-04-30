/**
 * Express application factory.
 * Kept separate from server.js so tests can import app without booting the HTTP server.
 */
'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const logger = require('./config/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Routes
const authRoutes        = require('./routes/auth');
const equipmentRoutes   = require('./routes/equipment');
const dataRoutes        = require('./routes/data');
const alarmRoutes       = require('./routes/alarms');
const predictionRoutes  = require('./routes/anomalies');
const maintenanceRoutes = require('./routes/maintenance');
const reportRoutes      = require('./routes/reports');
const userRoutes        = require('./routes/users');
const notesRoutes       = require('./routes/notes');
const messagesRoutes    = require('./routes/messages');

function buildApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet({ contentSecurityPolicy: false }));   // API only; CSP is handled by nginx
  app.use(compression());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Morgan -> Winston
  app.use(morgan(env.isProd ? 'combined' : 'dev', {
    stream: { write: (msg) => logger.http ? logger.http(msg.trim()) : logger.info(msg.trim()) },
  }));

  // Rate limit the public API (/api/*) only
  app.use('/api', rateLimit({
    windowMs: env.rateLimit.windowMs,
    max: env.rateLimit.max,
    standardHeaders: true, legacyHeaders: false,
  }));

  // Health & readiness
  app.get('/health',  (_req, res) => res.json({
    status: 'OK', service: 'backend',
    env: env.nodeEnv, time: new Date().toISOString(),
  }));
  app.get('/ready',   (_req, res) => res.json({ ready: true }));

  // Mount API
  app.use('/api/auth',         authRoutes);
  app.use('/api/equipment',    equipmentRoutes);
  app.use('/api/sensors',      dataRoutes);
  app.use('/api/alarms',       alarmRoutes);
  app.use('/api/predictions',  predictionRoutes);
  app.use('/api/maintenance',  maintenanceRoutes);
  app.use('/api/reports',      reportRoutes);
  app.use('/api/users',        userRoutes);
  app.use('/api/notes',        notesRoutes);
  app.use('/api/messages',     messagesRoutes);

  // 404 + central error handler
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { buildApp };
