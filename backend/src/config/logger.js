/**
 * Winston-based structured logger.
 * - JSON in production (for log aggregators),
 * - Human-readable in development.
 */
'use strict';

const { createLogger, format, transports } = require('winston');
const env = require('./env');

const devFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss.SSS' }),
  format.printf(({ timestamp, level, message, ...rest }) => {
    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    return `${timestamp} [${level}] ${message}${extra}`;
  })
);

const prodFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json()
);

const logger = createLogger({
  level: env.logLevel,
  defaultMeta: { service: 'backend' },
  format: env.isProd ? prodFormat : devFormat,
  transports: [new transports.Console()],
});

module.exports = logger;
