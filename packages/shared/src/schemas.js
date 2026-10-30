/**
 * FestPass Zod Schemas for API Requests and Distributed Payloads
 */

const { z } = require('zod');
const { NODE_ROLES, EVENT_STATUS, CHECKIN_MODE, OP_TYPES } = require('./constants');

// --- Auth Schemas ---
const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

// --- Event Schemas ---
const createEventSchema = z.object({
  name: z.string().trim().min(2, 'Event name must have at least 2 characters'),
  venue: z.string().trim().min(2, 'Venue is required'),
  startsAt: z.string().trim().min(1, 'startsAt ISO datetime string is required'),
  capacity: z.number().int().positive('Capacity must be greater than 0'),
  price: z.number().nonnegative('Price cannot be negative').default(0),
  status: z
    .enum([
      EVENT_STATUS.DRAFT,
      EVENT_STATUS.PUBLISHED,
      EVENT_STATUS.ACTIVE,
      EVENT_STATUS.COMPLETED,
      EVENT_STATUS.CANCELLED,
      EVENT_STATUS.ON_SALE,
      EVENT_STATUS.CLOSED,
    ])
    .default(EVENT_STATUS.ACTIVE),
  quotas: z.record(z.string(), z.number().int().nonnegative()).optional(),
});

const updateEventSchema = createEventSchema.partial();

// --- Ticket Schemas ---
const issueTicketSchema = z.object({
  eventId: z.string().trim().min(1, 'eventId is required'),
  holderName: z.string().trim().min(2, 'holderName must have at least 2 characters'),
  holderEmail: z.string().trim().email('Invalid holderEmail'),
  holderPhone: z.string().trim().min(7, 'holderPhone must have at least 7 digits'),
});

const bulkIssueItemSchema = z.object({
  holderName: z.string().trim().min(2, 'holderName must have at least 2 characters'),
  holderEmail: z.string().trim().email('Invalid holderEmail'),
  holderPhone: z.string().trim().min(7, 'holderPhone must have at least 7 digits'),
});

const bulkIssueTicketsSchema = z.object({
  eventId: z.string().trim().min(1, 'eventId is required'),
  tickets: z.array(bulkIssueItemSchema).min(1).max(20, 'Maximum 20 tickets per bulk transaction'),
});

const revokeTicketSchema = z.object({
  reason: z.string().trim().optional(),
});

const ticketLookupQuerySchema = z.object({
  email: z.string().trim().email().optional(),
  phone: z.string().trim().optional(),
  eventId: z.string().trim().optional(),
});

// --- Gate Scanning Schemas ---
const scanTicketSchema = z.object({
  token: z.string().trim().min(1, 'Ticket token is required'),
  mode: z.enum([CHECKIN_MODE.ONLINE, CHECKIN_MODE.OFFLINE]).default(CHECKIN_MODE.ONLINE),
  offlineHlc: z.string().trim().optional(),
});

const batchScanItemSchema = z.object({
  token: z.string().trim().min(1),
  checkinId: z.string().trim().optional(),
  gateNodeId: z.string().trim().min(1),
  hlc: z.string().trim().min(1),
  scannedAt: z.string().trim().optional(),
});

const batchScanSchema = z.object({
  scans: z.array(batchScanItemSchema).min(1, 'Batch must contain at least one scan item'),
});

// --- Cluster & Replication Schemas ---
const peerHeartbeatSchema = z.object({
  nodeId: z.string().trim().min(1),
  url: z.string().url(),
  role: z.enum([NODE_ROLES.BOOTH, NODE_ROLES.GATE, NODE_ROLES.BOTH]),
  lastSeen: z.union([z.string(), z.number()]),
});

const gossipSchema = z.object({
  originNodeId: z.string().trim().min(1),
  hlc: z.string().trim().min(1),
  peers: z.array(peerHeartbeatSchema),
});

const syncRequestSchema = z.object({
  fromHlc: z.string().trim().optional(),
  originNodeId: z.string().trim().min(1),
  limit: z.number().int().positive().max(500).default(100),
});

const opLogEntrySchema = z.object({
  opId: z.string().trim().min(1),
  originNode: z.string().trim().min(1),
  hlc: z.string().trim().min(1),
  type: z.enum([
    OP_TYPES.EVENT_UPSERT,
    OP_TYPES.TICKET_ISSUED,
    OP_TYPES.TICKET_REVOKED,
    OP_TYPES.CHECKIN_RECORDED,
    OP_TYPES.CONFLICT_RESOLVED,
  ]),
  payloadJson: z.string().trim().min(2),
  appliedAt: z.string().trim().optional(),
});

const claimQuotaSchema = z.object({
  eventId: z.string().trim().min(1),
  targetNodeId: z.string().trim().min(1),
  amount: z.number().int().positive('Claim amount must be positive'),
});

const borrowQuotaSchema = z.object({
  eventId: z.string().trim().min(1, 'eventId is required'),
  amount: z.number().int().positive('Borrow amount must be positive'),
  peerNodeId: z.string().trim().optional(),
  targetNodeId: z.string().trim().optional(),
  requesterNodeId: z.string().trim().optional(),
});

const chaosSchema = z.object({
  action: z.enum(['delay', 'partition', 'drop', 'reset']),
  targetNodeId: z.string().trim().optional(),
  delayMs: z.number().int().nonnegative().optional(),
  enabled: z.boolean().optional(),
});

module.exports = {
  loginSchema,
  createEventSchema,
  updateEventSchema,
  issueTicketSchema,
  bulkIssueItemSchema,
  bulkIssueTicketsSchema,
  revokeTicketSchema,
  ticketLookupQuerySchema,
  scanTicketSchema,
  batchScanItemSchema,
  batchScanSchema,
  peerHeartbeatSchema,
  gossipSchema,
  syncRequestSchema,
  opLogEntrySchema,
  claimQuotaSchema,
  borrowQuotaSchema,
  chaosSchema,
};
