/**
 * Zod-based request validation middleware.
 *
 * Usage:
 *   const { z } = require('zod');
 *   router.post('/x', validate({ body: z.object({...}) }), handler);
 */
'use strict';

const { ApiError } = require('./errorHandler');

function validate(schemas) {
  return (req, _res, next) => {
    try {
      for (const part of ['body', 'query', 'params']) {
        if (schemas[part]) {
          const parsed = schemas[part].parse(req[part]);
          // Can't reassign req.query in express 5, but fine in 4:
          req[part] = parsed;
        }
      }
      next();
    } catch (err) {
      next(new ApiError(400, 'Validation failed', err.issues || err.message));
    }
  };
}

module.exports = { validate };
