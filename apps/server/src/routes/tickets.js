/**
 * Ticket Issuance and Lookup Routes
 */

const express = require('express');
const {
  issueTicketSchema,
  bulkIssueTicketsSchema,
  revokeTicketSchema,
  ticketLookupQuerySchema,
  ERROR_CODES,
} = require('@festpass/shared');
const ticketService = require('../services/ticketService');
const { authenticate, requireRoles, requireNodeRole } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * Common handler for ticket issuing
 */
async function handleIssueTicket(req, res, next) {
  try {
    const validated = issueTicketSchema.parse(req.body);
    const idempotencyKey = req.headers['idempotency-key'] || null;

    const ticket = await ticketService.issueTicket({
      ...validated,
      idempotencyKey,
    });

    res.status(201).json({
      success: true,
      ticket,
    });
  } catch (err) {
    next(err);
  }
}

// POST /tickets/issue and POST /tickets (booth_staff or admin, booth nodes only)
router.post(
  '/issue',
  authenticate,
  requireRoles('booth_staff', 'admin'),
  requireNodeRole('booth'),
  handleIssueTicket
);
router.post(
  '/',
  authenticate,
  requireRoles('booth_staff', 'admin'),
  requireNodeRole('booth'),
  handleIssueTicket
);

// POST /tickets/bulk - Bulk issue for group bookings (up to 20 tickets in 1 transaction)
router.post(
  '/bulk',
  authenticate,
  requireRoles('booth_staff', 'admin'),
  requireNodeRole('booth'),
  async (req, res, next) => {
    try {
      const validated = bulkIssueTicketsSchema.parse(req.body);
      const idempotencyKey = req.headers['idempotency-key'] || null;

      const result = await ticketService.issueBulkTickets({
        ...validated,
        idempotencyKey,
      });

      res.status(201).json({
        success: true,
        count: result.count,
        tickets: result.tickets,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /tickets/:id - Get ticket by ID
router.get('/:id', async (req, res, next) => {
  try {
    const ticket = await ticketService.getTicketById(req.params.id);
    if (!ticket) {
      throw new AppError(`Ticket with id '${req.params.id}' not found`, 404, ERROR_CODES.NOT_FOUND);
    }
    res.status(200).json({ success: true, ticket });
  } catch (err) {
    next(err);
  }
});

// GET /tickets/:id/status - Get detailed status, fraud alert, and checkin history
router.get('/:id/status', async (req, res, next) => {
  try {
    const statusInfo = await ticketService.getTicketStatus(req.params.id);
    if (!statusInfo) {
      throw new AppError(`Ticket with id '${req.params.id}' not found`, 404, ERROR_CODES.NOT_FOUND);
    }
    res.status(200).json({ success: true, ...statusInfo });
  } catch (err) {
    next(err);
  }
});

// GET /tickets - Query tickets by holder email, phone, or eventId
router.get(
  '/',
  authenticate,
  requireRoles('booth_staff', 'gate_staff', 'admin'),
  (req, res, next) => {
    try {
      const query = ticketLookupQuerySchema.parse(req.query);
      const tickets = ticketService.queryTickets(query);
      res.status(200).json({ success: true, tickets });
    } catch (err) {
      next(err);
    }
  }
);

// POST /tickets/:id/revoke - Revoke ticket (admin only)
router.post('/:id/revoke', authenticate, requireRoles('admin'), async (req, res, next) => {
  try {
    const validated = revokeTicketSchema.parse(req.body);
    const result = await ticketService.revokeTicket(req.params.id, validated.reason);
    res.status(200).json({ success: true, ticket: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
