/**
 * FestPass Shared Constants
 */

const ROLES = Object.freeze({
  ADMIN: 'admin',
  BOOTH_STAFF: 'booth_staff',
  GATE_STAFF: 'gate_staff',
});

const NODE_ROLES = Object.freeze({
  BOOTH: 'booth',
  GATE: 'gate',
  BOTH: 'both',
});

const TICKET_STATUS = Object.freeze({
  VALID: 'valid',
  USED: 'used',
  REVOKED: 'revoked',
});

const EVENT_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  ON_SALE: 'on_sale',
  CLOSED: 'closed',
});

const CHECKIN_MODE = Object.freeze({
  ONLINE: 'online',
  OFFLINE: 'offline',
});

const CHECKIN_RESULT = Object.freeze({
  ACCEPTED: 'accepted',
  REJECTED_DUPLICATE: 'rejected_duplicate',
  REJECTED_INVALID: 'rejected_invalid',
});

const PEER_STATUS = Object.freeze({
  HEALTHY: 'healthy',
  SUSPECT: 'suspect',
  DEAD: 'dead',
});

const OP_TYPES = Object.freeze({
  EVENT_UPSERT: 'EVENT_UPSERT',
  TICKET_ISSUED: 'TICKET_ISSUED',
  TICKET_REVOKED: 'TICKET_REVOKED',
  CHECKIN_RECORDED: 'CHECKIN_RECORDED',
  CONFLICT_RESOLVED: 'CONFLICT_RESOLVED',
});

const ERROR_CODES = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  OVER_QUOTA: 'OVER_QUOTA',
  INVALID_TOKEN: 'INVALID_TOKEN',
  ALREADY_USED: 'ALREADY_USED',
  REPLICATION_ERROR: 'REPLICATION_ERROR',
  PEER_UNREACHABLE: 'PEER_UNREACHABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

const SOCKET_EVENTS = Object.freeze({
  CLUSTER_UPDATE: 'cluster:update',
  TICKET_ISSUED: 'ticket:issued',
  CHECKIN_RESULT: 'checkin:result',
  CONFLICT_DETECTED: 'conflict:detected',
});

// Default cluster node mapping for the 6 nodes
const CLUSTER_NODES = Object.freeze([
  { nodeId: 'B1', nodeIndex: 1, role: NODE_ROLES.BOOTH, defaultPort: 4001 },
  { nodeId: 'B2', nodeIndex: 2, role: NODE_ROLES.BOOTH, defaultPort: 4002 },
  { nodeId: 'B3', nodeIndex: 3, role: NODE_ROLES.BOOTH, defaultPort: 4003 },
  { nodeId: 'G1', nodeIndex: 4, role: NODE_ROLES.GATE, defaultPort: 4004 },
  { nodeId: 'G2', nodeIndex: 5, role: NODE_ROLES.GATE, defaultPort: 4005 },
  { nodeId: 'G3', nodeIndex: 6, role: NODE_ROLES.GATE, defaultPort: 4006 },
]);

module.exports = {
  ROLES,
  NODE_ROLES,
  TICKET_STATUS,
  EVENT_STATUS,
  CHECKIN_MODE,
  CHECKIN_RESULT,
  PEER_STATUS,
  OP_TYPES,
  ERROR_CODES,
  SOCKET_EVENTS,
  CLUSTER_NODES,
};
