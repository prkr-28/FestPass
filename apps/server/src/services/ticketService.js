/**
 * Ticket Service
 *
 * Implements:
 * - Atomic local quota checking & oversell prevention
 * - Snowflake ID generation
 * - Ed25519 token signing
 * - OpLog replication entry (TICKET_ISSUED, TICKET_REVOKED)
 * - Idempotency key tracking via SQLite meta table
 * - Socket.IO real-time event broadcasting
 * - Peer quota borrowing with unreachable failure handling
 */

const { OP_TYPES, ERROR_CODES, CLUSTER_NODES } = require('@festpass/shared');
const config = require('../config');
const logger = require('../logger');
const { getDb } = require('../db');
const idService = require('./idService');
const hlcService = require('./hlcService');
const tokenService = require('./tokenService');
const replicationService = require('./replicationService');
const { broadcastTicketIssued } = require('../socket');
const { AppError } = require('../middleware/errorHandler');

/**
 * Verifies that the current node is configured as a booth node
 */
function assertBoothNode() {
  if (config.nodeRole !== 'booth' && config.nodeRole !== 'both') {
    throw new AppError(
      `Gate nodes cannot issue tickets. Node role is '${config.nodeRole}'`,
      403,
      ERROR_CODES.FORBIDDEN
    );
  }
}

/**
 * Check idempotency cache in SQLite meta table
 */
function getIdempotencyRecord(key) {
  if (!key) return null;
  const db = getDb();
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(`idempotency:${key}`);
  if (row) {
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Store response in idempotency cache
 */
function setIdempotencyRecord(key, value) {
  if (!key) return;
  const db = getDb();
  db.prepare(
    `
    INSERT INTO meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `
  ).run(`idempotency:${key}`, JSON.stringify(value));
}

/**
 * Issue a single ticket atomically from the node's local quota partition
 */
async function issueTicket({
  eventId,
  holderName,
  holderEmail,
  holderPhone,
  idempotencyKey = null,
}) {
  assertBoothNode();

  // Check idempotency cache
  if (idempotencyKey) {
    const cached = getIdempotencyRecord(idempotencyKey);
    if (cached) {
      logger.info({ idempotencyKey }, 'Returning cached ticket for idempotent request');
      return cached;
    }
  }

  const db = getDb();

  const transactionResult = db.transaction(() => {
    // 1. Verify event exists and is open for sale
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) {
      throw new AppError(`Event with id '${eventId}' not found`, 404, ERROR_CODES.NOT_FOUND);
    }
    if (event.status === 'closed' || event.status === 'cancelled') {
      throw new AppError(
        `Event '${event.name}' is '${event.status}' and not open for ticket sales`,
        400,
        ERROR_CODES.BAD_REQUEST
      );
    }

    // 2. Atomically verify and increment sold count against local booth quota
    const quotaUpdate = db
      .prepare(
        `UPDATE booth_quotas
         SET sold = sold + 1
         WHERE event_id = ? AND node_id = ? AND sold < quota`
      )
      .run(eventId, config.nodeId);

    if (quotaUpdate.changes === 0) {
      // Check if quota row exists
      const quotaRow = db
        .prepare('SELECT quota, sold FROM booth_quotas WHERE event_id = ? AND node_id = ?')
        .get(eventId, config.nodeId);

      if (!quotaRow) {
        throw new AppError(
          `No quota allocated to node '${config.nodeId}' for event '${eventId}'`,
          409,
          ERROR_CODES.OVER_QUOTA
        );
      }
      throw new AppError(
        `Booth quota exhausted (${quotaRow.sold}/${quotaRow.quota}) for event '${eventId}' on node '${config.nodeId}'`,
        409,
        ERROR_CODES.OVER_QUOTA
      );
    }

    // 3. Generate Snowflake ID & HLC timestamp
    const ticketId = idService.generateId();
    const issuedAtHlc = hlcService.send().toString();

    // 4. Cryptographically sign ticket with Ed25519 private key
    const token = tokenService.sign(ticketId, eventId);

    // 5. Insert ticket row
    db.prepare(
      `INSERT INTO tickets (id, event_id, holder_name, holder_email, holder_phone, issued_by_node, issued_at_hlc, status, token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'valid', ?, datetime('now'))`
    ).run(
      ticketId,
      eventId,
      holderName,
      holderEmail,
      holderPhone,
      config.nodeId,
      issuedAtHlc,
      token
    );

    const ticketRecord = {
      ticketId,
      eventId,
      holderName,
      holderEmail,
      holderPhone,
      issuedByNode: config.nodeId,
      status: 'valid',
      token,
      issuedAtHlc,
    };

    // 6. Write op_log entry for state machine replication
    const opId = idService.generateId();
    const opRecord = {
      op_id: opId,
      origin_node: config.nodeId,
      hlc: issuedAtHlc,
      type: OP_TYPES.TICKET_ISSUED,
      payload_json: JSON.stringify(ticketRecord),
    };
    db.prepare(
      `INSERT INTO op_log (op_id, origin_node, hlc, type, payload_json, applied_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(opId, config.nodeId, issuedAtHlc, OP_TYPES.TICKET_ISSUED, JSON.stringify(ticketRecord));

    // 7. Store in idempotency cache
    if (idempotencyKey) {
      setIdempotencyRecord(idempotencyKey, ticketRecord);
    }

    return { ticketRecord, opRecord };
  })();

  const { ticketRecord: ticket, opRecord } = transactionResult;

  // 8. Trigger eager push replication to cluster
  if (opRecord) {
    replicationService.notifyNewOp(opRecord);
  }

  // 9. Broadcast real-time Socket.IO event
  broadcastTicketIssued(ticket);

  return ticket;
}

/**
 * Bulk issue tickets (up to 20) in a single atomic transaction
 */
async function issueBulkTickets({ eventId, tickets, idempotencyKey = null }) {
  assertBoothNode();

  if (!Array.isArray(tickets) || tickets.length === 0) {
    throw new AppError(
      'Tickets array must contain at least 1 ticket',
      400,
      ERROR_CODES.BAD_REQUEST
    );
  }

  if (tickets.length > 20) {
    throw new AppError(
      'Bulk ticket issuance limited to a maximum of 20 tickets per transaction',
      400,
      ERROR_CODES.BAD_REQUEST
    );
  }

  if (idempotencyKey) {
    const cached = getIdempotencyRecord(idempotencyKey);
    if (cached) {
      return cached;
    }
  }

  const db = getDb();
  const count = tickets.length;

  const result = db.transaction(() => {
    // 1. Verify event exists
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) {
      throw new AppError(`Event with id '${eventId}' not found`, 404, ERROR_CODES.NOT_FOUND);
    }
    if (event.status === 'closed' || event.status === 'cancelled') {
      throw new AppError(
        `Event '${event.name}' is '${event.status}' and not open for ticket sales`,
        400,
        ERROR_CODES.BAD_REQUEST
      );
    }

    // 2. Atomically decrement quota by count
    const quotaUpdate = db
      .prepare(
        `UPDATE booth_quotas
         SET sold = sold + ?
         WHERE event_id = ? AND node_id = ? AND sold + ? <= quota`
      )
      .run(count, eventId, config.nodeId, count);

    if (quotaUpdate.changes === 0) {
      const quotaRow = db
        .prepare('SELECT quota, sold FROM booth_quotas WHERE event_id = ? AND node_id = ?')
        .get(eventId, config.nodeId);

      const available = quotaRow ? quotaRow.quota - quotaRow.sold : 0;
      throw new AppError(
        `Insufficient quota on node '${config.nodeId}' for event '${eventId}'. Requested ${count}, available ${available}`,
        409,
        ERROR_CODES.OVER_QUOTA
      );
    }

    const issuedTickets = [];
    const insertTicketStmt = db.prepare(
      `INSERT INTO tickets (id, event_id, holder_name, holder_email, holder_phone, issued_by_node, issued_at_hlc, status, token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'valid', ?, datetime('now'))`
    );
    const insertOpLogStmt = db.prepare(
      `INSERT INTO op_log (op_id, origin_node, hlc, type, payload_json, applied_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    );

    const newOps = [];

    for (const item of tickets) {
      const ticketId = idService.generateId();
      const issuedAtHlc = hlcService.send().toString();
      const token = tokenService.sign(ticketId, eventId);

      insertTicketStmt.run(
        ticketId,
        eventId,
        item.holderName,
        item.holderEmail,
        item.holderPhone,
        config.nodeId,
        issuedAtHlc,
        token
      );

      const ticketRecord = {
        ticketId,
        eventId,
        holderName: item.holderName,
        holderEmail: item.holderEmail,
        holderPhone: item.holderPhone,
        issuedByNode: config.nodeId,
        status: 'valid',
        token,
        issuedAtHlc,
      };

      const opId = idService.generateId();
      const opRecord = {
        op_id: opId,
        origin_node: config.nodeId,
        hlc: issuedAtHlc,
        type: OP_TYPES.TICKET_ISSUED,
        payload_json: JSON.stringify(ticketRecord),
      };

      insertOpLogStmt.run(
        opId,
        config.nodeId,
        issuedAtHlc,
        OP_TYPES.TICKET_ISSUED,
        JSON.stringify(ticketRecord)
      );

      issuedTickets.push(ticketRecord);
      newOps.push(opRecord);
    }

    const bulkPayload = {
      count: issuedTickets.length,
      tickets: issuedTickets,
    };

    if (idempotencyKey) {
      setIdempotencyRecord(idempotencyKey, bulkPayload);
    }

    return { bulkPayload, newOps };
  })();

  const { bulkPayload, newOps } = result;

  // Broadcast to replication engine
  for (const op of newOps) {
    replicationService.notifyNewOp(op);
  }

  // Broadcast Socket.IO events for each ticket
  for (const t of bulkPayload.tickets) {
    broadcastTicketIssued(t);
  }

  return bulkPayload;
}

/**
 * Get ticket by ID
 */
async function getTicketById(ticketId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  if (!row) return null;

  return {
    ticketId: row.id,
    eventId: row.event_id,
    holderName: row.holder_name,
    holderEmail: row.holder_email,
    holderPhone: row.holder_phone,
    issuedByNode: row.issued_by_node,
    issuedAtHlc: row.issued_at_hlc,
    status: row.status,
    token: row.token,
    createdAt: row.created_at,
  };
}

/**
 * Query tickets by email, phone, or eventId
 */
function queryTickets({ email, phone, eventId }) {
  const db = getDb();
  let sql = 'SELECT * FROM tickets WHERE 1=1';
  const params = [];

  if (email) {
    sql += ' AND holder_email = ?';
    params.push(email);
  }
  if (phone) {
    sql += ' AND holder_phone = ?';
    params.push(phone);
  }
  if (eventId) {
    sql += ' AND event_id = ?';
    params.push(eventId);
  }

  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({
    ticketId: r.id,
    eventId: r.event_id,
    holderName: r.holder_name,
    holderEmail: r.holder_email,
    holderPhone: r.holder_phone,
    issuedByNode: r.issued_by_node,
    issuedAtHlc: r.issued_at_hlc,
    status: r.status,
    token: r.token,
    createdAt: r.created_at,
  }));
}

/**
 * Revoke a ticket (Admin only)
 */
async function revokeTicket(ticketId, reason = '') {
  const db = getDb();

  const transactionResult = db.transaction(() => {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) {
      throw new AppError(`Ticket with id '${ticketId}' not found`, 404, ERROR_CODES.NOT_FOUND);
    }

    if (ticket.status === 'revoked') {
      return {
        result: {
          ticketId: ticket.id,
          eventId: ticket.event_id,
          status: 'revoked',
          reason: 'Already revoked',
        },
        opRecord: null,
      };
    }

    db.prepare("UPDATE tickets SET status = 'revoked' WHERE id = ?").run(ticketId);

    const hlc = hlcService.send().toString();
    const opId = idService.generateId();
    const payload = JSON.stringify({
      ticketId,
      eventId: ticket.event_id,
      reason,
      revokedAtHlc: hlc,
    });

    const opRecord = {
      op_id: opId,
      origin_node: config.nodeId,
      hlc,
      type: OP_TYPES.TICKET_REVOKED,
      payload_json: payload,
    };

    db.prepare(
      `INSERT INTO op_log (op_id, origin_node, hlc, type, payload_json, applied_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(opId, config.nodeId, hlc, OP_TYPES.TICKET_REVOKED, payload);

    return {
      result: {
        ticketId,
        eventId: ticket.event_id,
        status: 'revoked',
        reason,
      },
      opRecord,
    };
  })();

  if (transactionResult.opRecord) {
    replicationService.notifyNewOp(transactionResult.opRecord);
  }

  return transactionResult.result;
}

/**
 * Get sales statistics aggregated per event and per booth
 */
function getSalesStats({ eventId = null, nodeId = null } = {}) {
  const db = getDb();

  let eventWhere = '';
  const eventParams = [];
  if (eventId) {
    eventWhere = 'WHERE e.id = ?';
    eventParams.push(eventId);
  }

  const eventsSummary = db
    .prepare(
      `SELECT
         e.id as event_id,
         e.name as event_name,
         e.capacity,
         e.price,
         e.status,
         COALESCE(SUM(bq.quota), 0) as total_quota,
         COALESCE(SUM(bq.sold), 0) as total_sold,
         COALESCE(SUM(bq.sold) * e.price, 0.0) as total_revenue
       FROM events e
       LEFT JOIN booth_quotas bq ON e.id = bq.event_id
       ${eventWhere}
       GROUP BY e.id`
    )
    .all(...eventParams);

  let quotaWhere = '';
  const quotaParams = [];
  if (nodeId) {
    quotaWhere = 'WHERE node_id = ?';
    quotaParams.push(nodeId);
  }

  const boothSummary = db
    .prepare(
      `SELECT
         node_id,
         COUNT(DISTINCT event_id) as events_count,
         COALESCE(SUM(quota), 0) as total_allocated_quota,
         COALESCE(SUM(sold), 0) as total_tickets_sold
       FROM booth_quotas
       ${quotaWhere}
       GROUP BY node_id`
    )
    .all(...quotaParams);

  let totalSold = 0;
  let totalRevenue = 0;
  for (const ev of eventsSummary) {
    totalSold += ev.total_sold;
    totalRevenue += ev.total_revenue;
  }

  return {
    totalSold,
    totalRevenue,
    byEvent: eventsSummary,
    byBooth: boothSummary,
  };
}

/**
 * Lend quota to a peer booth (Executed on Peer / Lender node)
 */
function transferQuotaToPeer({ eventId, requesterNodeId, amount }) {
  assertBoothNode();

  const db = getDb();
  return db.transaction(() => {
    const quotaRow = db
      .prepare('SELECT quota, sold FROM booth_quotas WHERE event_id = ? AND node_id = ?')
      .get(eventId, config.nodeId);

    if (!quotaRow) {
      return {
        approved: false,
        transferred: 0,
        reason: `Node '${config.nodeId}' has no quota row for event '${eventId}'`,
      };
    }

    const available = quotaRow.quota - quotaRow.sold;
    if (available <= 0) {
      return {
        approved: false,
        transferred: 0,
        reason: `Node '${config.nodeId}' has 0 available quota (sold ${quotaRow.sold}/${quotaRow.quota})`,
      };
    }

    const transferred = Math.min(amount, available);
    db.prepare('UPDATE booth_quotas SET quota = quota - ? WHERE event_id = ? AND node_id = ?').run(
      transferred,
      eventId,
      config.nodeId
    );

    const updatedRow = db
      .prepare('SELECT quota, sold FROM booth_quotas WHERE event_id = ? AND node_id = ?')
      .get(eventId, config.nodeId);

    logger.info(
      { eventId, requesterNodeId, transferred, newQuota: updatedRow.quota },
      'Quota slice transferred to peer node'
    );

    return {
      approved: true,
      transferred,
      newQuota: updatedRow.quota,
    };
  })();
}

/**
 * Borrow quota from a peer booth (Executed on Requester / Borrower node)
 * Communicates with peer over HTTP and handles peer unreachable failure
 */
async function borrowQuotaFromPeer({ eventId, targetNodeId, amount }) {
  assertBoothNode();

  if (!targetNodeId || targetNodeId === config.nodeId) {
    throw new AppError(
      'targetNodeId must be a valid peer booth node distinct from current node',
      400,
      ERROR_CODES.BAD_REQUEST
    );
  }

  // Lookup target node URL from peers table or config
  const db = getDb();
  let peerUrl = null;
  const peerRow = db.prepare('SELECT url FROM peers WHERE node_id = ?').get(targetNodeId);
  if (peerRow) {
    peerUrl = peerRow.url;
  }

  if (!peerUrl && config.getPeerList) {
    const p = config.getPeerList().find((entry) => entry.nodeId === targetNodeId);
    if (p) peerUrl = p.url;
  }

  if (!peerUrl) {
    // Deduce standard local port for cluster nodes
    const nodeMapping = CLUSTER_NODES.find((n) => n.nodeId === targetNodeId);
    if (nodeMapping) {
      peerUrl = `http://localhost:${nodeMapping.defaultPort}`;
    }
  }

  if (!peerUrl) {
    throw new AppError(
      `Target peer node '${targetNodeId}' URL could not be resolved`,
      404,
      ERROR_CODES.PEER_UNREACHABLE
    );
  }

  let peerResponse;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${peerUrl}/internal/quota/borrow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventId,
        requesterNodeId: config.nodeId,
        amount,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`HTTP ${response.status}: ${errBody}`);
    }

    peerResponse = await response.json();
  } catch (err) {
    logger.warn(
      { targetNodeId, peerUrl, err: err.message },
      'Failed to reach peer for quota borrow'
    );
    throw new AppError(
      `Peer booth '${targetNodeId}' unreachable for quota borrow: ${err.message}`,
      503,
      ERROR_CODES.PEER_UNREACHABLE
    );
  }

  if (!peerResponse.approved || peerResponse.transferred <= 0) {
    throw new AppError(
      `Peer booth '${targetNodeId}' denied quota borrow: ${peerResponse.reason || 'No available quota'}`,
      409,
      ERROR_CODES.OVER_QUOTA
    );
  }

  // Increment local quota on requester node
  const transferred = peerResponse.transferred;
  const newLocalQuota = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO booth_quotas (event_id, node_id, quota, sold)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(event_id, node_id) DO UPDATE SET quota = quota + excluded.quota
    `
    ).run(eventId, config.nodeId, transferred);

    const row = db
      .prepare('SELECT quota, sold FROM booth_quotas WHERE event_id = ? AND node_id = ?')
      .get(eventId, config.nodeId);

    return row.quota;
  })();

  logger.info(
    { eventId, targetNodeId, transferred, newLocalQuota },
    'Successfully borrowed quota from peer node'
  );

  return {
    approved: true,
    transferred,
    newQuota: newLocalQuota,
  };
}

module.exports = {
  issueTicket,
  issueBulkTickets,
  getTicketById,
  queryTickets,
  revokeTicket,
  getSalesStats,
  transferQuotaToPeer,
  borrowQuotaFromPeer,
  getIdempotencyRecord,
};
