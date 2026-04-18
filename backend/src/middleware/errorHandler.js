/**
 * Centralised error handler + 404.
 * Use `next(err)` or `throw new ApiError(...)` from anywhere in the app.
 */
'use strict';

const logger = require('../config/logger');

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function notFound(req, res, _next) {
  res.status(404).json({
    error: 'Not Found',
    message: `No route: ${req.method} ${req.originalUrl}`,
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    logger.error('unhandled error', {
      err: err.message, stack: err.stack, path: req.originalUrl,
    });
  } else {
    logger.warn('client error', { err: err.message, path: req.originalUrl, status });
  }

  res.status(status).json({
    error: err.name || 'Error',
    message: err.message || 'Internal server error',
    details: err.details || undefined,
  });
}

/** Wraps async route handlers so errors flow into errorHandler. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { ApiError, errorHandler, notFound, asyncHandler };
