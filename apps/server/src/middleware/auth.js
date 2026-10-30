/**
 * Authentication & Authorization Middleware
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const { ERROR_CODES } = require('@festpass/shared');
const { AppError } = require('./errorHandler');

/**
 * Verifies JWT bearer token from Authorization header
 */
function authenticate(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(
      new AppError('Authentication required: missing Bearer token', 401, ERROR_CODES.UNAUTHORIZED)
    );
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = payload;
    next();
  } catch (err) {
    return next(
      new AppError(
        'Invalid or expired authentication token',
        401,
        ERROR_CODES.UNAUTHORIZED,
        err.message
      )
    );
  }
}

/**
 * Requires specified user roles (e.g. 'admin', 'booth_staff', 'gate_staff')
 * @param  {...string} allowedRoles
 */
function requireRoles(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, ERROR_CODES.UNAUTHORIZED));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(
          `Access forbidden: requires one of roles [${allowedRoles.join(', ')}]`,
          403,
          ERROR_CODES.FORBIDDEN
        )
      );
    }

    next();
  };
}

/**
 * Requires specified node roles (e.g. 'booth' or 'both')
 * Gate nodes will be rejected with 403 FORBIDDEN.
 * @param  {...string} allowedNodeRoles
 */
function requireNodeRole(...allowedNodeRoles) {
  return (_req, _res, next) => {
    const currentRole = config.nodeRole;
    if (currentRole === 'both' || allowedNodeRoles.includes(currentRole)) {
      return next();
    }

    return next(
      new AppError(
        `Action forbidden for node role '${currentRole}'. Requires one of [${allowedNodeRoles.join(', ')}]`,
        403,
        ERROR_CODES.FORBIDDEN
      )
    );
  };
}

module.exports = {
  authenticate,
  requireRoles,
  requireNodeRole,
};
