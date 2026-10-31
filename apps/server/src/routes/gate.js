/**
 * Gate Validation & Scan Routes (Stage 4)
 *
 * Implements:
 * - POST /gate/scan (online quorum & offline signature validation)
 * - POST /gate/scan-offline-batch and POST /gate/scan/offline-batch (offline batch replay)
 * - GET /gate/checkins (checkin history with filtering and pagination)
 * - GET /gate/stats (gate entrance statistics and duplicates blocked)
 */

const express = require('express');
const { scanTicketSchema, batchScanSchema } = require('@festpass/shared');
const gateService = require('../services/gateService');
const { getDb } = require('../db');
const { authenticate, requireRoles, requireNodeRole } = require('../middleware/auth');

const router = express.Router();

/**
 * Common handler for ticket scanning
 */
async function handleScan(req, res, next) {
  try {
    const validated = scanTicketSchema.parse(req.body);
    const result = await gateService.validateAndCheckin(validated);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Common handler for batch offline scans
 */
async function handleOfflineBatch(req, res, next) {
  try {
    const validated = batchScanSchema.parse(req.body);
    const result = await gateService.processOfflineBatch(validated.scans);
    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

// POST /gate/scan
router.post(
  '/scan',
  authenticate,
  requireRoles('gate_staff', 'admin'),
  requireNodeRole('gate'),
  handleScan
);

// POST /gate/scan-offline-batch and alias /scan/offline-batch
router.post(
  '/scan-offline-batch',
  authenticate,
  requireRoles('gate_staff', 'admin'),
  requireNodeRole('gate'),
  handleOfflineBatch
);

router.post(
  '/scan/offline-batch',
  authenticate,
  requireRoles('gate_staff', 'admin'),
  requireNodeRole('gate'),
  handleOfflineBatch
);

// GET /gate/checkins
router.get(
  '/checkins',
  authenticate,
  requireRoles('gate_staff', 'admin'),
  (req, res, next) => {
    try {
      const db = getDb();
      const page = Math.max(Number(req.query.page || 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
      const offset = (page - 1) * limit;

      const whereClauses = [];
      const params = [];

      if (req.query.eventId) {
        whereClauses.push('ticket_id IN (SELECT id FROM tickets WHERE event_id = ?)');
        params.push(req.query.eventId);
      }
      if (req.query.ticketId) {
        whereClauses.push('ticket_id = ?');
        params.push(req.query.ticketId);
      }
      if (req.query.mode) {
        whereClauses.push('mode = ?');
        params.push(req.query.mode);
      }
      if (req.query.result) {
        whereClauses.push('result = ?');
        params.push(req.query.result);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const totalRow = db.prepare(`SELECT COUNT(*) as count FROM checkins ${whereSql}`).get(...params);
      const total = totalRow ? totalRow.count : 0;

      const checkins = db
        .prepare(`SELECT * FROM checkins ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset);

      res.status(200).json({
        success: true,
        checkins,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /gate/stats
router.get(
  '/stats',
  authenticate,
  requireRoles('gate_staff', 'admin'),
  (req, res, next) => {
    try {
      const eventId = req.query.eventId || null;
      const stats = gateService.getGateStats(eventId);
      res.status(200).json({
        success: true,
        ...stats,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
