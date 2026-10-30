/**
 * Authentication Routes
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { loginSchema, ERROR_CODES } = require('@festpass/shared');
const config = require('../config');
const { getDb } = require('../db');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

// Rate limiter for login endpoint to prevent brute force
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // 30 attempts per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many login attempts. Please try again later.',
    },
  },
});

// POST /login (or /api/auth/login)
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const validated = loginSchema.parse(req.body);
    const db = getDb();

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(validated.email);
    if (!user) {
      throw new AppError('Invalid email or password', 401, ERROR_CODES.UNAUTHORIZED);
    }

    const isMatch = await bcrypt.compare(validated.password, user.password_hash);
    if (!isMatch) {
      throw new AppError('Invalid email or password', 401, ERROR_CODES.UNAUTHORIZED);
    }

    const userProfile = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    const token = jwt.sign(userProfile, config.jwtSecret, { expiresIn: '24h' });

    res.status(200).json({
      success: true,
      token,
      user: userProfile,
    });
  } catch (err) {
    next(err);
  }
});

// GET /me (or /api/auth/me)
router.get('/me', authenticate, (req, res, next) => {
  try {
    const db = getDb();
    const user = db
      .prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?')
      .get(req.user.id);

    if (!user) {
      // Fallback to token payload if not present in local db
      return res.status(200).json({
        success: true,
        user: {
          id: req.user.id,
          name: req.user.name,
          email: req.user.email,
          role: req.user.role,
        },
      });
    }

    res.status(200).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
