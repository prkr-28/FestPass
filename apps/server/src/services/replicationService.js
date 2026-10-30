/**
 * Replication & Peer Membership Service (Stub for Stage 3)
 *
 * TODO(stage-3): Implement peer discovery, heartbeats, Phi-accrual or threshold failure detector,
 * gossip protocol for membership, and anti-entropy op_log synchronization.
 */

const logger = require('../logger');
const { getDb } = require('../db');

const { failureDetector } = require('./failureDetector');

async function handleGossip(payload) {
  return failureDetector.handleGossip(payload);
}

async function handleSync({ fromHlc, originNodeId, limit }) {
  // TODO(stage-3): Query op_log for entries strictly after fromHlc ordered by HLC
  logger.info({ fromHlc, originNodeId, limit }, 'TODO(stage-3): Sync request received');
  const db = getDb();
  let ops = [];

  if (fromHlc) {
    ops = db
      .prepare('SELECT * FROM op_log WHERE hlc > ? ORDER BY hlc ASC LIMIT ?')
      .all(fromHlc, limit || 100);
  } else {
    ops = db.prepare('SELECT * FROM op_log ORDER BY hlc ASC LIMIT ?').all(limit || 100);
  }

  return { ops, remaining: 0 };
}

async function claimQuota({ eventId, targetNodeId, amount }) {
  // TODO(stage-3): Inter-booth distributed quota rebalancing
  logger.info({ eventId, targetNodeId, amount }, 'TODO(stage-3): Claim quota invoked');
  return { approved: false, reason: 'Quota rebalancing not yet implemented (Stage 3)' };
}

module.exports = {
  handleGossip,
  handleSync,
  claimQuota,
};
