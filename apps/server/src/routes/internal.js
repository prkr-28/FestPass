/**
 * Internal Peer-to-Peer Distributed Routes
 *
 * Dedicated to internal cluster communication:
 * - Gossip membership exchange
 * - Anti-entropy log replication
 * - Inter-booth quota borrowing and claiming
 * - Chaos simulation hooks
 */

const express = require('express');
const {
  gossipSchema,
  syncRequestSchema,
  claimQuotaSchema,
  borrowQuotaSchema,
  chaosSchema,
} = require('@festpass/shared');
const config = require('../config');
const replicationService = require('../services/replicationService');
const hlcService = require('../services/hlcService');
const ticketService = require('../services/ticketService');

const router = express.Router();

// POST /internal/gossip
router.post('/gossip', async (req, res, next) => {
  try {
    const validated = gossipSchema.parse(req.body);
    // Update local HLC with remote message
    hlcService.receive(validated.hlc);
    const result = await replicationService.handleGossip(validated);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /internal/sync
router.post('/sync', async (req, res, next) => {
  try {
    const validated = syncRequestSchema.parse(req.body);
    const result = await replicationService.handleSync(validated);
    res.status(200).json({
      success: true,
      currentHlc: hlcService.now().toString(),
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

// POST /internal/quota/borrow - Inter-booth quota borrowing
router.post('/quota/borrow', async (req, res, next) => {
  try {
    const validated = borrowQuotaSchema.parse(req.body);
    const target = validated.targetNodeId || validated.peerNodeId;

    if (validated.requesterNodeId || !target || target === config.nodeId) {
      // Receiving peer: transfer quota from this node to requester
      const result = ticketService.transferQuotaToPeer({
        eventId: validated.eventId,
        requesterNodeId: validated.requesterNodeId || 'unknown_peer',
        amount: validated.amount,
      });
      return res.status(200).json(result);
    }

    // Initiating node: borrow quota from target peer
    const result = await ticketService.borrowQuotaFromPeer({
      eventId: validated.eventId,
      targetNodeId: target,
      amount: validated.amount,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /internal/claim - Quota claim (Contract 8.3 specification)
router.post('/claim', async (req, res, next) => {
  try {
    const validated = claimQuotaSchema.parse(req.body);

    if (validated.targetNodeId === config.nodeId) {
      // Transfer from local quota
      const result = ticketService.transferQuotaToPeer({
        eventId: validated.eventId,
        requesterNodeId: 'peer',
        amount: validated.amount,
      });
      return res.status(200).json(result);
    }

    // Request transfer from target peer
    const result = await ticketService.borrowQuotaFromPeer({
      eventId: validated.eventId,
      targetNodeId: validated.targetNodeId,
      amount: validated.amount,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /internal/chaos (for demo & chaos testing in Stage 6)
router.post('/chaos', (req, res, next) => {
  try {
    const validated = chaosSchema.parse(req.body);
    // TODO(stage-6): Hook into artificial network delay / partition middleware
    res.status(200).json({
      success: true,
      message: 'Chaos configuration accepted (Stage 6 hook)',
      chaos: validated,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
