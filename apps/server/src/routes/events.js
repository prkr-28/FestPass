/**
 * Events CRUD Routes
 */

const express = require('express');
const { createEventSchema, updateEventSchema, ERROR_CODES } = require('@festpass/shared');
const eventService = require('../services/eventService');
const { authenticate, requireRoles } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /events (or /api/events) - list events with search and pagination
router.get('/', (req, res, next) => {
  try {
    const { page, limit, search, q, status } = req.query;
    const result = eventService.listEvents({
      page,
      limit,
      search: search || q || '',
      status,
    });

    res.status(200).json({
      success: true,
      events: result.events,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
});

// POST /events (or /api/events) - create event (admin only)
router.post('/', authenticate, requireRoles('admin'), (req, res, next) => {
  try {
    const validated = createEventSchema.parse(req.body);
    const result = eventService.upsertEvent(validated);

    res.status(201).json({
      success: true,
      event: {
        id: result.event.id,
        name: result.event.name,
        venue: result.event.venue,
        starts_at: result.event.starts_at,
        capacity: result.event.capacity,
        price: result.event.price,
        status: result.event.status,
        quotas: result.quotas,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /events/:id (or /api/events/:id) - get event by ID
router.get('/:id', (req, res, next) => {
  try {
    const event = eventService.getEventById(req.params.id);
    if (!event) {
      throw new AppError(`Event with id '${req.params.id}' not found`, 404, ERROR_CODES.NOT_FOUND);
    }

    res.status(200).json({
      success: true,
      event,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /events/:id (or /api/events/:id) - update event (admin only)
router.put('/:id', authenticate, requireRoles('admin'), (req, res, next) => {
  try {
    const validated = updateEventSchema.parse(req.body);
    const result = eventService.upsertEvent(validated, req.params.id);

    res.status(200).json({
      success: true,
      id: req.params.id,
      event: result.event,
      updated: validated,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /events/:id (or /api/events/:id) - delete event (admin only)
router.delete('/:id', authenticate, requireRoles('admin'), (req, res, next) => {
  try {
    eventService.deleteEvent(req.params.id);
    res.status(200).json({
      success: true,
      message: `Event '${req.params.id}' deleted successfully`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
