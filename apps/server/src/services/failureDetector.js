/**
 * Membership & Failure Detection Service (Stage 3)
 *
 * Implements:
 * - Peer discovery from config and SQLite peers table
 * - Periodic gossip heartbeats (/internal/gossip)
 * - Timeout-based failure detector with states: alive, suspect, dead
 * - Automatic recovery when a dead/suspect node returns
 * - Persistence to SQLite peers table
 */

const { PEER_STATUS } = require('@festpass/shared');
const config = require('../config');
const logger = require('../logger');
const { getDb } = require('../db');
const hlcService = require('./hlcService');
const peerTransport = require('./peerTransport');

// Configurable failure detector thresholds (in milliseconds)
const DEFAULT_HEARTBEAT_INTERVAL_MS = 1000;
const DEFAULT_SUSPECT_TIMEOUT_MS = 3000; // 3 missed heartbeats -> suspect
const DEFAULT_DEAD_TIMEOUT_MS = 6000; // 6 missed heartbeats -> dead

class FailureDetector {
  constructor(options = {}) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.suspectTimeoutMs = options.suspectTimeoutMs || DEFAULT_SUSPECT_TIMEOUT_MS;
    this.deadTimeoutMs = options.deadTimeoutMs || DEFAULT_DEAD_TIMEOUT_MS;

    // In-memory tracking of last seen physical timestamp (ms)
    // Map<nodeId, number>
    this.lastSeenMap = new Map();
    this.timer = null;
    this.isRunning = false;

    // Listeners for peer status changes (nodeId, oldStatus, newStatus)
    this.listeners = new Set();
  }

  /**
   * Register a callback for peer status transitions
   */
  onStatusChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Start periodic gossip and failure detector evaluation
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Seed peers table from config if needed
    this.initPeersFromConfig();

    this.timer = setInterval(async () => {
      try {
        await this.tick();
      } catch (err) {
        logger.error({ err: err.message }, 'Error during failure detector tick');
      }
    }, this.heartbeatIntervalMs);

    if (this.timer.unref) {
      this.timer.unref();
    }

    logger.info(
      {
        nodeId: config.nodeId,
        intervalMs: this.heartbeatIntervalMs,
        suspectTimeoutMs: this.suspectTimeoutMs,
        deadTimeoutMs: this.deadTimeoutMs,
      },
      'Failure detector started'
    );
  }

  /**
   * Stop periodic failure detector
   */
  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Initialize peers in SQLite database from static config
   */
  initPeersFromConfig() {
    try {
      const db = getDb();
      const peers = config.getPeerList();
      const nowIso = new Date().toISOString();

      const stmt = db.prepare(`
        INSERT INTO peers (node_id, url, role, last_seen, status)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          url = excluded.url,
          role = excluded.role
      `);

      for (const peer of peers) {
        if (peer.nodeId === config.nodeId) continue;
        const role = peer.nodeId.startsWith('B') ? 'booth' : 'gate';
        stmt.run(peer.nodeId, peer.url, role, nowIso, PEER_STATUS.ALIVE);
        if (!this.lastSeenMap.has(peer.nodeId)) {
          this.lastSeenMap.set(peer.nodeId, Date.now());
        }
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to initialize peers table from config');
    }
  }

  /**
   * Record that a peer was seen alive right now
   */
  recordPeerAlive(nodeId, role = null, url = null) {
    if (!nodeId || nodeId === config.nodeId) return;

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    this.lastSeenMap.set(nodeId, nowMs);

    try {
      const db = getDb();
      const current = db.prepare('SELECT status, role, url FROM peers WHERE node_id = ?').get(nodeId);

      const oldStatus = current ? current.status : null;
      const targetRole = role || current?.role || (nodeId.startsWith('B') ? 'booth' : 'gate');
      const targetUrl = url || current?.url || peerTransport.resolvePeerUrl(nodeId) || '';

      db.prepare(`
        INSERT INTO peers (node_id, url, role, last_seen, status)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          last_seen = excluded.last_seen,
          status = excluded.status,
          role = coalesce(excluded.role, peers.role),
          url = coalesce(nullif(excluded.url, ''), peers.url)
      `).run(nodeId, targetUrl, targetRole, nowIso, PEER_STATUS.ALIVE);

      if (oldStatus && oldStatus !== PEER_STATUS.ALIVE && oldStatus !== PEER_STATUS.HEALTHY) {
        logger.info(
          { nodeId, oldStatus, newStatus: PEER_STATUS.ALIVE },
          'Peer recovered and transitioned to ALIVE'
        );
        for (const listener of this.listeners) {
          try {
            listener(nodeId, oldStatus, PEER_STATUS.ALIVE);
          } catch (e) {
            logger.error({ err: e.message }, 'Error in status change listener');
          }
        }
      }
    } catch (err) {
      logger.warn({ nodeId, err: err.message }, 'Failed to record peer alive');
    }
  }

  /**
   * Handle incoming gossip message from a remote peer
   */
  async handleGossip({ originNodeId, hlc, role, peers = [] }) {
    if (hlc) {
      hlcService.receive(hlc);
    }

    // Mark the sender as ALIVE
    this.recordPeerAlive(originNodeId, role);

    // Merge reported peers if they are newer
    try {
      const db = getDb();
      for (const peer of peers) {
        if (!peer.nodeId || peer.nodeId === config.nodeId) continue;

        const remoteLastSeenMs =
          typeof peer.lastSeen === 'number'
            ? peer.lastSeen
            : Date.parse(peer.lastSeen) || Date.now();

        const currentLocalMs = this.lastSeenMap.get(peer.nodeId) || 0;
        // If remote has seen them more recently, update our in-memory timestamp
        if (remoteLastSeenMs > currentLocalMs) {
          this.lastSeenMap.set(peer.nodeId, remoteLastSeenMs);
        }

        // Ensure peer exists in peers table
        db.prepare(`
          INSERT INTO peers (node_id, url, role, last_seen, status)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(node_id) DO UPDATE SET
            role = coalesce(excluded.role, peers.role),
            url = coalesce(nullif(excluded.url, ''), peers.url)
        `).run(
          peer.nodeId,
          peer.url || '',
          peer.role || (peer.nodeId.startsWith('B') ? 'booth' : 'gate'),
          new Date(remoteLastSeenMs).toISOString(),
          peer.status || PEER_STATUS.ALIVE
        );
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Error merging remote peer gossip');
    }

    return { success: true };
  }

  /**
   * Evaluate failure detector states based on last seen timestamps
   */
  evaluateStates() {
    const nowMs = Date.now();
    const db = getDb();
    const allPeers = db.prepare('SELECT node_id, status, last_seen FROM peers').all();

    for (const peer of allPeers) {
      if (peer.node_id === config.nodeId) continue;

      let lastSeenMs = this.lastSeenMap.get(peer.node_id);
      if (!lastSeenMs) {
        lastSeenMs = Date.parse(peer.last_seen) || nowMs;
        this.lastSeenMap.set(peer.node_id, lastSeenMs);
      }

      const elapsed = nowMs - lastSeenMs;
      let newStatus = PEER_STATUS.ALIVE;

      if (elapsed > this.deadTimeoutMs) {
        newStatus = PEER_STATUS.DEAD;
      } else if (elapsed > this.suspectTimeoutMs) {
        newStatus = PEER_STATUS.SUSPECT;
      }

      // If status changed, update DB and trigger listeners
      if (newStatus !== peer.status && (peer.status !== PEER_STATUS.HEALTHY || newStatus !== PEER_STATUS.ALIVE)) {
        logger.warn(
          { nodeId: peer.node_id, oldStatus: peer.status, newStatus, elapsedMs: elapsed },
          'Peer failure detector state changed'
        );

        db.prepare('UPDATE peers SET status = ? WHERE node_id = ?').run(newStatus, peer.node_id);

        for (const listener of this.listeners) {
          try {
            listener(peer.node_id, peer.status, newStatus);
          } catch (e) {
            logger.error({ err: e.message }, 'Error in status change listener');
          }
        }
      }
    }

    try {
      const { broadcastClusterUpdate } = require('../socket');
      const activePeers = allPeers.filter(
        (p) => p.status === PEER_STATUS.ALIVE || p.status === PEER_STATUS.HEALTHY
      ).length;
      broadcastClusterUpdate({
        nodeId: config.nodeId,
        hlc: hlcService.now().toString(),
        activePeers,
        status: 'healthy',
      });
    } catch (_e) {
      // Ignore if socket not initialized
    }
  }

  /**
   * Execute one gossip and detection round
   */
  async tick() {
    // 1. Evaluate peer states
    this.evaluateStates();

    // 2. Broadcast gossip heartbeats to all configured peers
    const db = getDb();
    const peers = db.prepare('SELECT node_id, url, role, last_seen, status FROM peers WHERE node_id != ?').all(config.nodeId);

    const gossipPayload = {
      originNodeId: config.nodeId,
      role: config.nodeRole,
      hlc: hlcService.now().toString(),
      peers: peers.map((p) => ({
        nodeId: p.node_id,
        url: p.url,
        role: p.role,
        lastSeen: this.lastSeenMap.get(p.node_id) || Date.parse(p.last_seen) || Date.now(),
        status: p.status,
      })),
    };

    // Gossip to each peer
    for (const peer of peers) {
      try {
        await peerTransport.post(peer.node_id, '/internal/gossip', gossipPayload, { timeoutMs: 1500 });
        // If peer responded with 200 OK, mark it alive immediately
        this.recordPeerAlive(peer.node_id, peer.role, peer.url);
      } catch (_err) {
        // Failed to gossip - failure detector will handle suspect/dead timeout
      }
    }
  }

  /**
   * Get all peer states as an array
   */
  getPeerStates() {
    const db = getDb();
    return db.prepare('SELECT * FROM peers ORDER BY node_id ASC').all();
  }

  /**
   * Check if a peer is alive (alive or healthy)
   */
  isAlive(nodeId) {
    if (nodeId === config.nodeId) return true;
    try {
      const db = getDb();
      const row = db.prepare('SELECT status FROM peers WHERE node_id = ?').get(nodeId);
      return row ? row.status === PEER_STATUS.ALIVE || row.status === PEER_STATUS.HEALTHY : false;
    } catch (_e) {
      return false;
    }
  }
}

// Singleton instance
const failureDetector = new FailureDetector();

module.exports = {
  FailureDetector,
  failureDetector,
};
