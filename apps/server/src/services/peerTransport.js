/**
 * Peer Transport Layer with Chaos Simulation Hooks (Stage 3)
 *
 * Handles HTTP communication between cluster nodes, enforcing:
 * - Network partition simulation (block traffic to/from specific peers)
 * - Artificial network latency
 * - Message drop percentages
 * - Dynamic peer URL resolution
 */

const { CLUSTER_NODES, ERROR_CODES } = require('@festpass/shared');
const config = require('../config');
const logger = require('../logger');
const { getDb } = require('../db');

const { AppError } = require('../middleware/errorHandler');

// Active chaos state (shared on global to guarantee singleton across ESM/CJS boundaries)
if (!global.__festpass_chaos) {
  global.__festpass_chaos = {
    partitions: new Set(),
    delays: new Map(),
    dropRates: new Map(),
  };
}
const { partitions, delays, dropRates } = global.__festpass_chaos;

/**
 * Configure chaos simulation rules
 */
function applyChaos({
  action,
  targetNodeId,
  delayMs = 0,
  dropRate = null,
  percentage = null,
  enabled = true,
}) {
  if (action === 'reset') {
    partitions.clear();
    delays.clear();
    dropRates.clear();
    logger.info('Chaos rules reset to clean network state');
    return getChaosState();
  }

  const target = targetNodeId || '*';

  if (action === 'partition') {
    if (enabled !== false) {
      if (targetNodeId) partitions.add(targetNodeId);
      logger.warn({ targetNodeId }, 'Simulated network partition enabled for peer');
    } else {
      if (targetNodeId) partitions.delete(targetNodeId);
      logger.info({ targetNodeId }, 'Simulated network partition disabled for peer');
    }
  } else if (action === 'delay') {
    if (enabled !== false && delayMs > 0) {
      delays.set(target, delayMs);
      logger.warn({ target, delayMs }, 'Simulated network latency injected');
    } else {
      delays.delete(target);
      logger.info({ target }, 'Simulated network latency removed');
    }
  } else if (action === 'drop') {
    const rate = dropRate !== null ? dropRate : percentage !== null ? percentage / 100 : 0.5;
    if (enabled !== false && rate > 0) {
      dropRates.set(target, rate);
      logger.warn({ target, dropRate: rate }, 'Simulated packet drop rate injected');
    } else {
      dropRates.delete(target);
      logger.info({ target }, 'Simulated packet drop rate removed');
    }
  }

  return getChaosState();
}

/**
 * Return current active chaos state
 */
function getChaosState() {
  return {
    partitions: Array.from(partitions),
    delays: Object.fromEntries(delays),
    dropRates: Object.fromEntries(dropRates),
  };
}

/**
 * Reset all chaos rules
 */
function resetChaos() {
  partitions.clear();
  delays.clear();
  dropRates.clear();
}

/**
 * Check if current node is partitioned from targetNodeId
 */
function isPartitioned(targetNodeId) {
  return partitions.has(targetNodeId) || partitions.has('*');
}

/**
 * Check inbound request against active chaos rules.
 * Throws AppError(503) if partitioned or dropped.
 */
async function checkInboundChaos(originNodeId) {
  if (!originNodeId) return;

  if (isPartitioned(originNodeId)) {
    throw new AppError(
      `Network partition: inbound traffic from node '${originNodeId}' is blocked by chaos hook`,
      503,
      ERROR_CODES.PEER_UNREACHABLE
    );
  }

  const dropRate = dropRates.get(originNodeId) ?? dropRates.get('*') ?? 0;
  if (dropRate > 0 && Math.random() < dropRate) {
    throw new AppError(
      `Simulated packet drop: inbound message from node '${originNodeId}' dropped`,
      503,
      ERROR_CODES.PEER_UNREACHABLE
    );
  }

  const delayMs = delays.get(originNodeId) ?? delays.get('*') ?? 0;
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

/**
 * Resolve the base HTTP URL for a given peer node ID
 */
function resolvePeerUrl(targetNodeId) {
  try {
    const db = getDb();
    const row = db.prepare('SELECT url FROM peers WHERE node_id = ?').get(targetNodeId);
    if (row && row.url) return row.url;
  } catch (_e) {
    // Database might not be initialized yet in early startup
  }

  if (config.getPeerList) {
    const peer = config.getPeerList().find((p) => p.nodeId === targetNodeId);
    if (peer && peer.url) return peer.url;
  }

  const mapping = CLUSTER_NODES.find((n) => n.nodeId === targetNodeId);
  if (mapping) {
    return `http://localhost:${mapping.defaultPort}`;
  }

  return null;
}

/**
 * Send an HTTP request to a peer node, honoring chaos simulation hooks
 */
async function sendRequest(
  targetNodeId,
  endpointPath,
  { method = 'POST', body = null, headers = {}, timeoutMs = 3000 } = {}
) {
  // 1. Verify partition rule
  if (isPartitioned(targetNodeId)) {
    throw new AppError(
      `Network partition: outbound traffic to node '${targetNodeId}' is blocked by chaos hook`,
      503,
      ERROR_CODES.PEER_UNREACHABLE
    );
  }

  // 2. Verify drop rule
  const dropRate = dropRates.get(targetNodeId) ?? dropRates.get('*') ?? 0;
  if (dropRate > 0 && Math.random() < dropRate) {
    throw new AppError(
      `Simulated packet drop: outbound message to node '${targetNodeId}' dropped`,
      503,
      ERROR_CODES.PEER_UNREACHABLE
    );
  }

  // 3. Inject artificial latency
  const delayMs = delays.get(targetNodeId) ?? delays.get('*') ?? 0;
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  // 4. Resolve peer URL
  const baseUrl = resolvePeerUrl(targetNodeId);
  if (!baseUrl) {
    throw new AppError(
      `Target peer node '${targetNodeId}' URL could not be resolved`,
      404,
      ERROR_CODES.PEER_UNREACHABLE
    );
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/${endpointPath.replace(/^\/+/, '')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-FestPass-Node-Id': config.nodeId,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timer);

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_e) {
      data = { raw: text };
    }

    if (!response.ok) {
      const errorMsg = data?.error?.message || data?.message || `HTTP ${response.status}`;
      const err = new AppError(
        errorMsg,
        response.status,
        data?.error?.code || ERROR_CODES.PEER_UNREACHABLE
      );
      err.response = data;
      throw err;
    }

    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new AppError(
        `Peer request to ${targetNodeId} (${url}) timed out after ${timeoutMs}ms`,
        504,
        ERROR_CODES.PEER_UNREACHABLE
      );
    }
    if (err instanceof AppError) throw err;

    throw new AppError(
      `Failed to communicate with peer ${targetNodeId} (${url}): ${err.message}`,
      503,
      ERROR_CODES.PEER_UNREACHABLE
    );
  }
}

module.exports = {
  applyChaos,
  getChaosState,
  resetChaos,
  isPartitioned,
  checkInboundChaos,
  resolvePeerUrl,
  sendRequest,
  post: (targetNodeId, path, body, options) =>
    sendRequest(targetNodeId, path, { method: 'POST', body, ...options }),
  get: (targetNodeId, path, options) =>
    sendRequest(targetNodeId, path, { method: 'GET', ...options }),
};
