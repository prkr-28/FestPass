/**
 * Global Express Error Handler
 * Standardizes API error responses across the cluster.
 */

const { ZodError } = require('zod');
const { ERROR_CODES } = require('@festpass/shared');

class AppError extends Error {
  constructor(message, statusCode = 400, code = ERROR_CODES.BAD_REQUEST, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function errorHandler(err, req, res, _next) {
  const log = req.log || console;

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Validation failed',
        details: err.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      },
    });
  }

  // Handle explicit AppError
  if (err instanceof AppError || err.name === 'AppError') {
    const statusCode = err.statusCode || err.status || 500;
    return res.status(statusCode).json({
      success: false,
      error: {
        code: err.code || ERROR_CODES.INTERNAL_ERROR,
        message: err.message,
        details: err.details,
      },
    });
  }

  // Handle JSON parse errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: {
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Malformed JSON payload in request body',
      },
    });
  }

  // Handle SQLite constraint violations
  if (err.code && err.code.startsWith('SQLITE_CONSTRAINT')) {
    log.warn({ err }, 'SQLite constraint violation');
    return res.status(409).json({
      success: false,
      error: {
        code: ERROR_CODES.CONFLICT,
        message: err.message,
      },
    });
  }

  // Unexpected internal errors
  log.error({ err, stack: err.stack }, 'Unhandled internal server error');
  return res.status(err.statusCode || 500).json({
    success: false,
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    },
  });
}

module.exports = {
  errorHandler,
  AppError,
};
