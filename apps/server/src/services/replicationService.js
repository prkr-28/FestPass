/**
 * Replication & Peer Membership Service (Stage 3)
 *
 * Implements:
 * 1. Push Replication: Eager log broadcast with retry, exponential backoff, and per-peer outbox
 * 2. Pull Anti-Entropy: Periodic version-vector sync exchanging missing ops in batches
 * 3. Idempotent State-Machine Apply: CRDT convergence via crdtEngine
 * 4. Cluster Outbox & Version Vector Telemetry
 */

const { HLC } = require('@festpass/shared');
const config = require('../config');
const logger = require('../logger');
const { getDb } = require('../db');
const hlcService = require('./hlcService');
const peerTransport = require('./peerTransport');
const { failureDetector } = require('./failureDetector');
const crdtEngine = require('./crdtEngine');

const DEFAULT_SYNC_INTERVAL_MS = 2000;
const DEFAULT_OUTBOX_DRAIN_INTERVAL_MS = 2000;

class ReplicationService {
  constructor() {
    this.syncIntervalMs = DEFAULT_SYNC_INTERVAL_MS;
    this.outboxDrainIntervalMs = DEFAULT_OUTBOX_DRAIN_INTERVAL_MS;
    this.syncTimer = null;
    this.outboxTimer = null;
    this.isRunning = false;

    // Hook failure detector recovery to immediately drain outbox and sync
    failureDetector.onStatusChange((nodeId, _oldStatus, newStatus) => {
      if (newStatus === 'alive' || newStatus === 'healthy') {
        logger.info({ nodeId }, 'Peer recovered, triggering outbox drain and catch-up sync');
        this.drainOutbox(nodeId).catch((err) =>
          logger.debug({ nodeId, err: err.message }, 'Immediate outbox drain failed')
        );
        this.syncWithPeer(nodeId).catch((err) =>
          logger.debug({ nodeId, err: err.message }, 'Immediate sync failed')
        );
      }
    });
  }

  /**
   * Start replication background tasks (failure detector, anti-entropy sync, outbox drain)
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Start membership & failure detector
    failureDetector.start();

    // Periodic pull anti-entropy sync
    this.syncTimer = setInterval(async () => {
      try {
        await this.syncAllPeers();
      } catch (err) {
        logger.debug({ err: err.message }, 'Periodic anti-entropy sync error');
      }
    }, this.syncIntervalMs);
    if (this.syncTimer.unref) this.syncTimer.unref();

    // Periodic outbox drain
    this.outboxTimer = setInterval(async () => {
      try {
        await this.drainOutbox();
      } catch (err) {
        logger.debug({ err: err.message }, 'Periodic outbox drain error');
      }
    }, this.outboxDrainIntervalMs);
    if (this.outboxTimer.unref) this.outboxTimer.unref();

    logger.info('Replication service started');
  }

  /**
   * Stop replication background tasks
   */
  stop() {
    this.isRunning = false;
    failureDetector.stop();

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.outboxTimer) {
      clearInterval(this.outboxTimer);
      this.outboxTimer = null;
    }
  }

  /**
   * Compute version vector (highest HLC seen per origin node)
   */
  getVersionVector() {
    const db = getDb();
    const rows = db
      .prepare(
        `
        SELECT origin_node, MAX(hlc) as max_hlc
        FROM op_log
        GROUP BY origin_node
      `
      )
      .all();

    const vector = {};
    for (const row of rows) {
      vector[row.origin_node] = row.max_hlc;
    }
    return vector;
  }

  /**
   * Return per-peer outbox sizes
   */
  getOutboxSizes() {
    const db = getDb();
    const rows = db
      .prepare(
        `
        SELECT peer_node_id, count(*) as count
        FROM outbox
        GROUP BY peer_node_id
      `
      )
      .all();

    const sizes = {};
    for (const r of rows) {
      sizes[r.peer_node_id] = r.count;
    }
    return sizes;
  }

  /**
   * Add an operation ID to a peer's outbox
   */
  addToOutbox(peerNodeId, opId) {
    if (!peerNodeId || peerNodeId === config.nodeId) return;
    try {
      const db = getDb();
      db.prepare(
        `
        INSERT INTO outbox (peer_node_id, op_id, attempts, last_attempt_at, created_at)
        VALUES (?, ?, 0, datetime('now'), datetime('now'))
        ON CONFLICT(peer_node_id, op_id) DO UPDATE SET
          attempts = attempts + 1,
          last_attempt_at = datetime('now')
      `
      ).run(peerNodeId, opId);
    } catch (err) {
      logger.warn({ peerNodeId, opId, err: err.message }, 'Failed to queue op to outbox');
    }
  }

  /**
   * Remove an operation ID from a peer's outbox
   */
  removeFromOutbox(peerNodeId, opId) {
    try {
      const db = getDb();
      db.prepare('DELETE FROM outbox WHERE peer_node_id = ? AND op_id = ?').run(peerNodeId, opId);
    } catch (_e) {
      // Ignore
    }
  }

  /**
   * Notify replication engine of a newly generated local op.
   * Broadcasts to all alive peers eagerly; queues to outbox for dead/lagging peers.
   */
  notifyNewOp(op) {
    if (!this.isRunning) return;
    this.pushOp(op).catch((err) => {
      logger.debug(
        { opId: op.op_id, err: err.message },
        'Eager push encountered error; buffered in outbox'
      );
    });
  }

  /**
   * Eager Push Replication: send a new op to all peers with retry and exponential backoff
   */
  async pushOp(op) {
    const db = getDb();
    const peers = db.prepare('SELECT node_id FROM peers WHERE node_id != ?').all(config.nodeId);

    const pushPromises = peers.map(async (peer) => {
      const peerNodeId = peer.node_id;

      // If peer is dead or suspect, queue directly to outbox
      if (!failureDetector.isAlive(peerNodeId)) {
        this.addToOutbox(peerNodeId, op.op_id);
        return;
      }

      // Try sending with retry and exponential backoff
      try {
        await this.sendOpsWithRetry(peerNodeId, [op]);
      } catch (_err) {
        // Retries failed, queue in outbox for background drainage
        this.addToOutbox(peerNodeId, op.op_id);
      }
    });

    await Promise.allSettled(pushPromises);
  }

  /**
   * Send a list of ops to a target peer with retry and exponential backoff
   */
  async sendOpsWithRetry(peerNodeId, ops, maxRetries = 3) {
    let attempt = 0;
    let delay = 100;

    while (attempt < maxRetries) {
      try {
        await peerTransport.post(
          peerNodeId,
          '/internal/replicate',
          {
            originNodeId: config.nodeId,
            hlc: hlcService.now().toString(),
            ops,
          },
          { timeoutMs: 2500 }
        );

        // Success: remove delivered ops from outbox
        for (const op of ops) {
          this.removeFromOutbox(peerNodeId, op.op_id);
        }
        return;
      } catch (err) {
        attempt++;
        if (attempt >= maxRetries) {
          throw err;
        }
        await new Promise((res) => setTimeout(res, delay));
        delay *= 2;
      }
    }
  }

  /**
   * Drain pending outbox operations to one or all peers
   */
  async drainOutbox(targetPeerId = null) {
    const db = getDb();
    const peersToDrain = targetPeerId
      ? [{ node_id: targetPeerId }]
      : db.prepare('SELECT DISTINCT peer_node_id as node_id FROM outbox').all();

    for (const peer of peersToDrain) {
      if (!failureDetector.isAlive(peer.node_id)) continue;

      const pendingRows = db
        .prepare(
          `
          SELECT o.op_id, l.origin_node, l.hlc, l.type, l.payload_json, l.applied_at
          FROM outbox o
          JOIN op_log l ON o.op_id = l.op_id
          WHERE o.peer_node_id = ?
          ORDER BY l.hlc ASC
          LIMIT 100
        `
        )
        .all(peer.node_id);

      if (pendingRows.length === 0) continue;

      try {
        await this.sendOpsWithRetry(peer.node_id, pendingRows, 2);
      } catch (_e) {
        // Peer still unreachable; keep in outbox
      }
    }
  }

  /**
   * Handle incoming push replication payload from a peer
   */
  async handleReplicate({ originNodeId, hlc, ops = [] }) {
    if (hlc) {
      hlcService.receive(hlc);
    }
    failureDetector.recordPeerAlive(originNodeId);

    const db = getDb();
    const result = crdtEngine.applyBatch(db, ops);

    return {
      success: true,
      appliedCount: result.appliedCount,
      skippedCount: result.skippedCount,
      currentHlc: hlcService.now().toString(),
    };
  }

  /**
   * Handle anti-entropy sync request from a peer
   * Queries op_log for entries strictly after caller's version vector / watermark
   */
  async handleSync({ fromHlc, versionVector = {}, originNodeId, limit = 100 }) {
    const db = getDb();
    failureDetector.recordPeerAlive(originNodeId);

    const allOps = db.prepare('SELECT * FROM op_log ORDER BY hlc ASC').all();
    const missingOps = [];

    for (const op of allOps) {
      let isMissing = false;

      if (versionVector && Object.keys(versionVector).length > 0) {
        const remoteHlc = versionVector[op.origin_node];
        if (!remoteHlc || HLC.compare(op.hlc, remoteHlc) > 0) {
          isMissing = true;
        }
      } else if (fromHlc) {
        if (HLC.compare(op.hlc, fromHlc) > 0) {
          isMissing = true;
        }
      } else {
        isMissing = true;
      }

      if (isMissing) {
        missingOps.push(op);
      }
    }

    const totalMissing = missingOps.length;
    const batch = missingOps.slice(0, limit);
    const remaining = Math.max(0, totalMissing - batch.length);

    return {
      ops: batch,
      remaining,
      versionVector: this.getVersionVector(),
    };
  }

  /**
   * Pull missing ops from a specific peer using version-vector anti-entropy
   */
  async syncWithPeer(peerNodeId) {
    if (!peerNodeId || peerNodeId === config.nodeId) return;
    if (!failureDetector.isAlive(peerNodeId)) return;

    const localVector = this.getVersionVector();

    let hasRemaining = true;
    let iterations = 0;
    const maxIterations = 20;

    while (hasRemaining && iterations < maxIterations) {
      iterations++;
      const response = await peerTransport.post(
        peerNodeId,
        '/internal/sync',
        {
          originNodeId: config.nodeId,
          versionVector: localVector,
          limit: 100,
        },
        { timeoutMs: 3000 }
      );

      if (!response || !Array.isArray(response.ops)) break;

      if (response.currentHlc) {
        hlcService.receive(response.currentHlc);
      }

      if (response.ops.length > 0) {
        const db = getDb();
        crdtEngine.applyBatch(db, response.ops);
      }

      hasRemaining = response.remaining > 0;
    }
  }

  /**
   * Execute anti-entropy sync against all alive peers
   */
  async syncAllPeers() {
    const db = getDb();
    const peers = db.prepare('SELECT node_id FROM peers WHERE node_id != ?').all(config.nodeId);

    for (const peer of peers) {
      if (failureDetector.isAlive(peer.node_id)) {
        try {
          await this.syncWithPeer(peer.node_id);
        } catch (_err) {
          // Sync error handled per peer
        }
      }
    }
  }

  /**
   * Inter-booth distributed quota claim stub
   */
  async claimQuota({ eventId, targetNodeId, amount }) {
    logger.info({ eventId, targetNodeId, amount }, 'Claim quota invoked');
    return { approved: false, reason: 'Quota rebalancing handled in Stage 2' };
  }
}

const replicationService = new ReplicationService();

module.exports = {
  ReplicationService,
  replicationService,
  handleGossip: (payload) => failureDetector.handleGossip(payload),
  handleSync: (payload) => replicationService.handleSync(payload),
  handleReplicate: (payload) => replicationService.handleReplicate(payload),
  claimQuota: (payload) => replicationService.claimQuota(payload),
  notifyNewOp: (op) => replicationService.notifyNewOp(op),
  pushOp: (op) => replicationService.pushOp(op),
  start: () => replicationService.start(),
  stop: () => replicationService.stop(),
};
