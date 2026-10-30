/**
 * Sales Statistics Routes
 */

const express = require('express');
const ticketService = require('../services/ticketService');

const router = express.Router();

// GET /stats/sales (or /api/stats/sales) - Sales statistics per event and per booth
router.get('/sales', (req, res, next) => {
  try {
    const { eventId, boothId, nodeId } = req.query;
    const stats = ticketService.getSalesStats({
      eventId: eventId || null,
      nodeId: boothId || nodeId || null,
    });

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
