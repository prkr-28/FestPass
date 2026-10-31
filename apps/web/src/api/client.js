/**
 * Resilient Distributed Failover API Client (Stage 5)
 *
 * Implements:
 * - Multi-node failover across Booth (4001-4003) and Gate (4004-4006) nodes
 * - Idempotency-Key header attachment for safe automated retries
 * - Automatic failover notification and active node tracking
 * - JWT authorization interceptors and 401 handling
 */

import axios from 'axios';

const DEFAULT_BOOTH_NODES = [
  'http://localhost:4001',
  'http://localhost:4002',
  'http://localhost:4003',
];
const DEFAULT_GATE_NODES = [
  'http://localhost:4004',
  'http://localhost:4005',
  'http://localhost:4006',
];

export const BOOTH_NODES = (import.meta.env?.VITE_BOOTH_NODES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (BOOTH_NODES.length === 0) BOOTH_NODES.push(...DEFAULT_BOOTH_NODES);

export const GATE_NODES = (import.meta.env?.VITE_GATE_NODES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (GATE_NODES.length === 0) GATE_NODES.push(...DEFAULT_GATE_NODES);

// State tracking for connected nodes
let activeBoothIndex = 0;
let activeGateIndex = 0;
const listeners = new Set();

export function getActiveBoothNode() {
  return BOOTH_NODES[activeBoothIndex];
}

export function getActiveGateNode() {
  return GATE_NODES[activeGateIndex];
}

export function setActiveBoothNode(url) {
  const idx = BOOTH_NODES.indexOf(url);
  if (idx !== -1) {
    activeBoothIndex = idx;
    notifyListeners();
  }
}

export function setActiveGateNode(url) {
  const idx = GATE_NODES.indexOf(url);
  if (idx !== -1) {
    activeGateIndex = idx;
    notifyListeners();
  }
}

export function subscribeNodeChanges(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notifyListeners() {
  const state = {
    boothNode: getActiveBoothNode(),
    gateNode: getActiveGateNode(),
    allBoothNodes: BOOTH_NODES,
    allGateNodes: GATE_NODES,
  };
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch (_e) {}
  });
}

/**
 * Creates an Axios instance bound to a base URL with standard auth interceptor
 */
function createBaseAxios(baseURL) {
  const instance = axios.create({
    baseURL,
    timeout: 3500,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  instance.interceptors.request.use((reqConfig) => {
    try {
      const stored = localStorage.getItem('festpass_auth');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.state?.token) {
          reqConfig.headers.Authorization = `Bearer ${parsed.state.token}`;
        }
      }
    } catch (_e) {}
    return reqConfig;
  });

  return instance;
}

/**
 * Executes a resilient HTTP request with automatic node failover
 */
export async function resilientRequest(options, targetType = 'booth') {
  const nodes = targetType === 'gate' ? GATE_NODES : BOOTH_NODES;
  let startIndex = targetType === 'gate' ? activeGateIndex : activeBoothIndex;

  // Auto attach Idempotency-Key for POST/PUT if not already set
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if ((method === 'POST' || method === 'PUT') && !headers['Idempotency-Key']) {
    headers['Idempotency-Key'] = `idem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  let lastError = null;

  for (let attempt = 0; attempt < nodes.length; attempt++) {
    const nodeIndex = (startIndex + attempt) % nodes.length;
    const nodeUrl = nodes[nodeIndex];
    const client = createBaseAxios(nodeUrl);

    try {
      const response = await client({
        ...options,
        headers,
      });

      // If we failed over to a new node, save it as the active working node
      if (nodeIndex !== startIndex) {
        if (targetType === 'gate') {
          activeGateIndex = nodeIndex;
        } else {
          activeBoothIndex = nodeIndex;
        }
        notifyListeners();
      }

      return response;
    } catch (err) {
      lastError = err;

      // Handle 401 Unauthorized: token expired or invalid
      if (err.response?.status === 401) {
        try {
          localStorage.removeItem('festpass_auth');
          window.dispatchEvent(new CustomEvent('festpass:auth_expired'));
        } catch (_e) {}
        throw err;
      }

      // Do NOT failover on 400 Bad Request, 403 Forbidden, 404 Not Found, 409 Conflict/OverQuota
      // Only failover on network errors, timeouts, or 502/503/504 server down
      const status = err.response?.status;
      const isNetworkOrTimeout =
        !err.response || err.code === 'ECONNABORTED' || err.message?.includes('Network Error');
      const isServerDown = status === 502 || status === 503 || status === 504;

      if (!isNetworkOrTimeout && !isServerDown) {
        throw err;
      }

      // Log failover attempt
      console.warn(`[Failover] Node ${nodeUrl} unreachable (${err.message}). Trying next peer...`);
    }
  }

  throw lastError || new Error(`All ${targetType} nodes are unreachable`);
}

export const api = {
  get: (url, config, target = 'booth') =>
    resilientRequest({ method: 'GET', url, ...config }, target),
  post: (url, data, config, target = 'booth') =>
    resilientRequest({ method: 'POST', url, data, ...config }, target),
  put: (url, data, config, target = 'booth') =>
    resilientRequest({ method: 'PUT', url, data, ...config }, target),
  delete: (url, config, target = 'booth') =>
    resilientRequest({ method: 'DELETE', url, ...config }, target),
};
