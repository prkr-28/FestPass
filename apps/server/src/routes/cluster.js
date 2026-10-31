/**
 * Cluster & Replication Observability Routes (Stage 3 & 4)
 *
 * Implements endpoints per contract & Stage 3 specifications:
 * - GET /cluster/nodes (peer membership states, last_seen, replication lag in ops and ms)
 * - GET /cluster/replication (outbox sizes, version vectors, total ops)
 * - GET /cluster/replication-status (contract 7.2)
 * - GET /cluster/conflicts (contract 7.3)
 * - GET /cluster/stats (contract 7.4)
 */

const express = require('express');
const config = require('../config');
const hlcService = require('../services/hlcService');
const { replicationService } = require('../services/replicationService');
const { failureDetector } = require('../services/failureDetector');
const { getDb } = require('../db');

const router = express.Router();

// GET /api/cluster/nodes & GET /cluster/nodes
router.get('/nodes', (_req, res, next) => {
  try {
    const db = getDb();
    const peers = db.prepare('SELECT * FROM peers ORDER BY node_id ASC').all();
    const outboxSizes = replicationService.getOutboxSizes();
    const nowMs = Date.now();

    const peersWithLag = peers.map((peer) => {
      const lastSeenMs =
        failureDetector.lastSeenMap.get(peer.node_id) || Date.parse(peer.last_seen) || nowMs;
      const replicationLagMs = Math.max(0, nowMs - lastSeenMs);
      const replicationLagOps = outboxSizes[peer.node_id] || 0;

      return {
        ...peer,
        replicationLagOps,
        replicationLagMs,
      };
    });

    res.status(200).json({
      success: true,
      currentNode: {
        nodeId: config.nodeId,
        role: config.nodeRole,
        port: config.port,
        hlc: hlcService.now().toString(),
      },
      peers: peersWithLag,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cluster/replication & GET /cluster/replication
router.get('/replication', (_req, res, next) => {
  try {
    const db = getDb();
    const opCount = db.prepare('SELECT count(*) as count FROM op_log').get()?.count || 0;
    const latestOp = db.prepare('SELECT * FROM op_log ORDER BY hlc DESC LIMIT 1').get() || null;
    const versionVector = replicationService.getVersionVector();
    const outboxSizes = replicationService.getOutboxSizes();

    res.status(200).json({
      success: true,
      nodeId: config.nodeId,
      hlc: hlcService.now().toString(),
      versionVector,
      outboxSizes,
      totalOperations: opCount,
      latestOperation: latestOp,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cluster/replication-status (API contract 7.2)
router.get('/replication-status', (_req, res, next) => {
  try {
    const db = getDb();
    const opCount = db.prepare('SELECT count(*) as count FROM op_log').get()?.count || 0;
    const latestOp = db.prepare('SELECT * FROM op_log ORDER BY hlc DESC LIMIT 1').get() || null;
    const versionVector = replicationService.getVersionVector();
    const outboxSizes = replicationService.getOutboxSizes();

    res.status(200).json({
      success: true,
      nodeId: config.nodeId,
      hlc: hlcService.now().toString(),
      versionVector,
      outboxSizes,
      totalOperations: opCount,
      latestOperation: latestOp,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cluster/conflicts (API contract 7.3)
router.get('/conflicts', (_req, res, next) => {
  try {
    const db = getDb();
    const conflicts = db.prepare('SELECT * FROM conflicts ORDER BY detected_at DESC').all();
    res.status(200).json({
      success: true,
      conflicts,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cluster/stats (API contract 7.4)
router.get('/stats', (_req, res, next) => {
  try {
    const db = getDb();
    const ticketCount = db.prepare('SELECT count(*) as count FROM tickets').get()?.count || 0;
    const checkinCount = db.prepare('SELECT count(*) as count FROM checkins').get()?.count || 0;
    const conflictCount = db.prepare('SELECT count(*) as count FROM conflicts').get()?.count || 0;
    const peerCount = db.prepare('SELECT count(*) as count FROM peers').get()?.count || 0;

    res.status(200).json({
      success: true,
      nodeId: config.nodeId,
      role: config.nodeRole,
      uptimeSeconds: Math.floor(process.uptime()),
      stats: {
        ticketsIssued: ticketCount,
        checkinsRecorded: checkinCount,
        conflictsDetected: conflictCount,
        peersTracked: peerCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
