/**
 * CRDT State-Machine Replication Apply Engine (Stage 3)
 *
 * Implements deterministic convergence rules for state replication:
 * 1. EVENT_UPSERT: Last-Writer-Wins (LWW) by HLC
 * 2. TICKET_ISSUED: Add-only set (IDs are globally unique 64-bit Snowflakes)
 * 3. TICKET_REVOKED: Wins over valid (revocation cannot be undone)
 * 4. CHECKIN_RECORDED: Documented extension hook for Stage 4 conflict resolution
 * 5. Booth quota changes: Replicate as deltas / preserve local sold counters
 */

const { HLC, OP_TYPES, TICKET_STATUS } = require('@festpass/shared');
const logger = require('../logger');
const hlcService = require('./hlcService');

/**
 * Apply a single op idempotently in a database transaction
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} op - { op_id, origin_node, hlc, type, payload_json, applied_at }
 * @returns {{ applied: boolean, reason?: string }}
 */
function applyOp(db, op) {
  // 1. Advance local clock with incoming HLC
  if (op.hlc) {
    try {
      hlcService.receive(op.hlc);
    } catch (_e) {
      // Clock drift warning handled by hlcService
    }
  }

  // 2. Idempotency Check: Same op_id never applied twice
  const existingOp = db.prepare('SELECT op_id FROM op_log WHERE op_id = ?').get(op.op_id);
  if (existingOp) {
    return { applied: false, reason: 'already_applied' };
  }

  let payload;
  try {
    payload = typeof op.payload_json === 'string' ? JSON.parse(op.payload_json) : op.payload_json;
  } catch (err) {
    logger.error({ opId: op.op_id, err: err.message }, 'Failed to parse op payload_json');
    return { applied: false, reason: 'invalid_payload_json' };
  }

  // 3. Record op in op_log table
  db.prepare(
    `
    INSERT INTO op_log (op_id, origin_node, hlc, type, payload_json, applied_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `
  ).run(
    op.op_id,
    op.origin_node,
    op.hlc,
    op.type,
    typeof op.payload_json === 'string' ? op.payload_json : JSON.stringify(op.payload_json)
  );

  // 4. Dispatch to type-specific CRDT state transition rules
  switch (op.type) {
    case OP_TYPES.EVENT_UPSERT:
      applyEventUpsert(db, op, payload);
      break;

    case OP_TYPES.TICKET_ISSUED:
      applyTicketIssued(db, op, payload);
      break;

    case OP_TYPES.TICKET_REVOKED:
      applyTicketRevoked(db, op, payload);
      break;

    case OP_TYPES.CHECKIN_RECORDED:
      applyCheckinRecorded(db, op, payload);
      break;

    case OP_TYPES.CONFLICT_RESOLVED:
      applyConflictResolved(db, op, payload);
      break;

    default:
      logger.warn(
        { type: op.type, opId: op.op_id },
        'Unknown operation type encountered during apply'
      );
  }

  return { applied: true };
}

/**
 * Apply a batch of ops sorted by HLC ascending in a single SQLite transaction
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Array<object>} ops
 * @returns {{ appliedCount: number, skippedCount: number }}
 */
function applyBatch(db, ops) {
  if (!ops || ops.length === 0) {
    return { appliedCount: 0, skippedCount: 0 };
  }

  // Sort strictly by HLC ascending for total causal order
  const sorted = [...ops].sort((a, b) => HLC.compare(a.hlc, b.hlc));

  let appliedCount = 0;
  let skippedCount = 0;

  const transaction = db.transaction(() => {
    for (const op of sorted) {
      const res = applyOp(db, op);
      if (res.applied) {
        appliedCount++;
      } else {
        skippedCount++;
      }
    }
  });

  transaction();
  return { appliedCount, skippedCount };
}

/**
 * Rule 1: EVENT_UPSERT (Last-Writer-Wins by HLC)
 */
function applyEventUpsert(db, op, payload) {
  const event = payload.event;
  if (!event || !event.id) return;

  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(event.id);

  if (!existing) {
    // New event: insert into events table
    db.prepare(
      `
      INSERT INTO events (id, name, venue, starts_at, capacity, price, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, coalesce(?, datetime('now')))
    `
    ).run(
      event.id,
      event.name,
      event.venue,
      event.starts_at,
      event.capacity,
      event.price,
      event.status || 'draft',
      event.created_at || null
    );

    // Populate initial booth quotas if provided
    if (Array.isArray(payload.quotas)) {
      const insertQuota = db.prepare(`
        INSERT INTO booth_quotas (event_id, node_id, quota, sold)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(event_id, node_id) DO UPDATE SET
          quota = excluded.quota
      `);
      for (const q of payload.quotas) {
        insertQuota.run(q.event_id || event.id, q.node_id, q.quota, q.sold || 0);
      }
    }
    return;
  }

  // Event exists: find the highest HLC of any previously applied EVENT_UPSERT for this event
  const lastOp = db
    .prepare(
      `
    SELECT hlc FROM op_log
    WHERE type = 'EVENT_UPSERT'
      AND op_id != ?
      AND (
        json_extract(payload_json, '$.event.id') = ?
        OR json_extract(payload_json, '$.eventId') = ?
      )
    ORDER BY hlc DESC LIMIT 1
  `
    )
    .get(op.op_id, event.id, event.id);

  const shouldUpdate = !lastOp || HLC.compare(op.hlc, lastOp.hlc) >= 0;

  if (shouldUpdate) {
    db.prepare(
      `
      UPDATE events SET
        name = ?,
        venue = ?,
        starts_at = ?,
        capacity = ?,
        price = ?,
        status = ?
      WHERE id = ?
    `
    ).run(
      event.name,
      event.venue,
      event.starts_at,
      event.capacity,
      event.price,
      event.status,
      event.id
    );

    // Update booth quotas without clobbering local sold counts
    if (Array.isArray(payload.quotas)) {
      const upsertQuota = db.prepare(`
        INSERT INTO booth_quotas (event_id, node_id, quota, sold)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(event_id, node_id) DO UPDATE SET
          quota = excluded.quota
      `);
      for (const q of payload.quotas) {
        upsertQuota.run(q.event_id || event.id, q.node_id, q.quota, q.sold || 0);
      }
    }
  }
}

/**
 * Rule 2: TICKET_ISSUED (Add-Only Set, IDs are globally unique 64-bit Snowflakes)
 * Never conflicts; if ticket was already revoked locally or remotely, revoked status wins.
 */
function applyTicketIssued(db, op, payload) {
  const ticketId = payload.ticketId || payload.id;
  const eventId = payload.eventId || payload.event_id;
  if (!ticketId || !eventId) return;

  const existingTicket = db.prepare('SELECT status FROM tickets WHERE id = ?').get(ticketId);

  // If ticket is already revoked, revocation permanently wins over valid
  if (existingTicket && existingTicket.status === TICKET_STATUS.REVOKED) {
    return;
  }

  // Ensure event exists to satisfy foreign key constraint during out-of-order replication
  db.prepare(
    `
    INSERT INTO events (id, name, venue, starts_at, capacity, price, status, created_at)
    VALUES (?, 'Pending Replication Event', 'TBD', datetime('now'), 0, 0, 'draft', datetime('now'))
    ON CONFLICT(id) DO NOTHING
  `
  ).run(eventId);

  db.prepare(
    `
    INSERT INTO tickets (id, event_id, holder_name, holder_email, holder_phone, issued_by_node, issued_at_hlc, status, token, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'valid', ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      status = CASE WHEN tickets.status = 'revoked' THEN 'revoked' ELSE excluded.status END,
      token = coalesce(tickets.token, excluded.token),
      holder_name = coalesce(tickets.holder_name, excluded.holder_name),
      holder_email = coalesce(tickets.holder_email, excluded.holder_email),
      holder_phone = coalesce(tickets.holder_phone, excluded.holder_phone)
  `
  ).run(
    ticketId,
    eventId,
    payload.holderName || payload.holder_name || '',
    payload.holderEmail || payload.holder_email || '',
    payload.holderPhone || payload.holder_phone || '',
    payload.issuedByNode || payload.issued_by_node || op.origin_node,
    payload.issuedAtHlc || payload.issued_at_hlc || op.hlc,
    payload.token || ''
  );
}

/**
 * Rule 3: TICKET_REVOKED (Wins over valid)
 * Updates status to 'revoked'. If ticket not yet received, inserts placeholder record so revocation wins.
 */
function applyTicketRevoked(db, op, payload) {
  const ticketId = payload.ticketId || payload.id;
  if (!ticketId) return;

  const existing = db.prepare('SELECT id FROM tickets WHERE id = ?').get(ticketId);

  if (existing) {
    db.prepare('UPDATE tickets SET status = ? WHERE id = ?').run(TICKET_STATUS.REVOKED, ticketId);
  } else {
    const eventId = payload.eventId || 'unknown_event';
    db.prepare(
      `
      INSERT INTO events (id, name, venue, starts_at, capacity, price, status, created_at)
      VALUES (?, 'Pending Replication Event', 'TBD', datetime('now'), 0, 0, 'draft', datetime('now'))
      ON CONFLICT(id) DO NOTHING
    `
    ).run(eventId);

    // Out-of-order delivery: insert stub marked revoked so when TICKET_ISSUED arrives, it remains revoked
    db.prepare(
      `
      INSERT INTO tickets (id, event_id, holder_name, holder_email, holder_phone, issued_by_node, issued_at_hlc, status, token, created_at)
      VALUES (?, ?, 'Revoked Ticket', '', '', ?, ?, ?, '', datetime('now'))
      ON CONFLICT(id) DO UPDATE SET status = ?
    `
    ).run(
      ticketId,
      eventId,
      op.origin_node,
      payload.revokedAtHlc || op.hlc,
      TICKET_STATUS.REVOKED,
      TICKET_STATUS.REVOKED
    );
  }
}

/**
 * Rule 4: CHECKIN_RECORDED
 *
 * =========================================================================
 * STAGE 4 EXTENSION POINT: Checkin Conflict Resolution Hook
 * =========================================================================
 * Stage 4 will define the exact distributed consensus and conflict
 * resolution for concurrent offline checkins (e.g., detecting if a ticket
 * was scanned concurrently at Gate 1 and Gate 2, resolving via HLC ordering,
 * and recording to the conflicts table).
 *
 * Stage 3 Baseline Apply Behavior:
 * - Insert checkin idempotently into checkins table
 * - If checkin result is accepted, update ticket status to 'used'
 * =========================================================================
 */
function applyCheckinRecorded(db, op, payload) {
  const checkinId = payload.checkinId || payload.id || op.op_id;
  const ticketId = payload.ticketId || payload.ticket_id;
  if (!ticketId) return;

  const existing = db.prepare('SELECT id FROM checkins WHERE id = ?').get(checkinId);
  if (!existing) {
    db.prepare(
      `
      INSERT INTO checkins (id, ticket_id, gate_node_id, hlc, mode, result, resolved, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO NOTHING
    `
    ).run(
      checkinId,
      ticketId,
      payload.gateNodeId || payload.gate_node_id || op.origin_node,
      payload.hlc || op.hlc,
      payload.mode || 'online',
      payload.result || 'accepted',
      payload.resolved ? 1 : 0
    );
  }

  // Stage 4 Conflict Resolution: Check all accepted checkins for this ticket
  const acceptedCheckins = db
    .prepare("SELECT * FROM checkins WHERE ticket_id = ? AND result = 'accepted'")
    .all(ticketId);

  if (acceptedCheckins.length > 1) {
    // Sort deterministically by HLC ascending (lowest HLC wins, tie-break by gate_node_id)
    acceptedCheckins.sort((a, b) => HLC.compare(a.hlc, b.hlc));
    const winner = acceptedCheckins[0];
    const losers = acceptedCheckins.slice(1);

    for (const loser of losers) {
      db.prepare(
        "UPDATE checkins SET result = 'rejected_duplicate', resolved = 1 WHERE id = ?"
      ).run(loser.id);

      const conflictId = `${winner.id}_${loser.id}`;
      const details = {
        reason: 'Offline concurrent check-in conflict. Winner had earlier HLC timestamp.',
        winnerGate: winner.gate_node_id,
        loserGate: loser.gate_node_id,
        winnerHlc: winner.hlc,
        loserHlc: loser.hlc,
        winnerTime: winner.created_at,
        loserTime: loser.created_at,
      };

      db.prepare(
        `
        INSERT INTO conflicts (id, ticket_id, winner_checkin_id, loser_checkin_id, detected_at, details_json)
        VALUES (?, ?, ?, ?, datetime('now'), ?)
        ON CONFLICT(id) DO NOTHING
      `
      ).run(conflictId, ticketId, winner.id, loser.id, JSON.stringify(details));

      try {
        db.prepare("UPDATE tickets SET fraud_alert = 1, status = 'used' WHERE id = ?").run(
          ticketId
        );
      } catch (_e) {
        db.prepare("UPDATE tickets SET status = 'used' WHERE id = ?").run(ticketId);
      }

      try {
        const { broadcastSocketEvent } = require('../socket');
        const { SOCKET_EVENTS } = require('@festpass/shared');
        broadcastSocketEvent(SOCKET_EVENTS.CONFLICT_DETECTED, {
          id: conflictId,
          ticketId,
          winnerCheckinId: winner.id,
          loserCheckinId: loser.id,
          details,
          detectedAt: new Date().toISOString(),
        });
      } catch (_e) {}
    }
  } else if (acceptedCheckins.length === 1) {
    db.prepare("UPDATE tickets SET status = 'used' WHERE id = ? AND status != 'revoked'").run(
      ticketId
    );
  }
}

/**
 * Rule 5: CONFLICT_RESOLVED (Stage 4 logs conflict resolutions)
 */
function applyConflictResolved(db, _op, payload) {
  if (!payload.id || !payload.ticketId) return;

  db.prepare(
    `
    INSERT INTO conflicts (id, ticket_id, winner_checkin_id, loser_checkin_id, detected_at, details_json)
    VALUES (?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(id) DO NOTHING
  `
  ).run(
    payload.id,
    payload.ticketId,
    payload.winnerCheckinId || '',
    payload.loserCheckinId || '',
    typeof payload.details === 'string' ? payload.details : JSON.stringify(payload.details || {})
  );
}

module.exports = {
  applyOp,
  applyBatch,
  applyEventUpsert,
  applyTicketIssued,
  applyTicketRevoked,
  applyCheckinRecorded,
};
