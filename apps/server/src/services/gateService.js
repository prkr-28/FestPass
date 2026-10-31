/**
 * Gate Validation Service (Stage 4)
 *
 * Implements:
 * 1. Asymmetric offline ticket token verification (Ed25519)
 * 2. Distributed Gate Quorum Claim Protocol for zero-coordination double-scan prevention
 * 3. Offline Mode validation under network partitions
 * 4. Deterministic conflict resolution for concurrent offline checkins
 * 5. Batch offline replay and reconciliation
 */

const { getDb } = require('../db');
const config = require('../config');
const logger = require('../logger');
const tokenService = require('./tokenService');
const hlcService = require('./hlcService');
const idService = require('./idService');
const peerTransport = require('./peerTransport');
const { replicationService } = require('./replicationService');
const { broadcastSocketEvent } = require('../socket');
const {
  HLC,
  OP_TYPES,
  SOCKET_EVENTS,
  CHECKIN_RESULT,
  CHECKIN_MODE,
  TICKET_STATUS,
  EVENT_STATUS,
} = require('@festpass/shared');

const GATE_NODES = ['G1', 'G2', 'G3'];
const MAX_CLAIM_RETRIES = 3;

/**
 * Grant or evaluate a ticket claim locally (acceptor role)
 */
function grantClaimLocally(ticketId, claimantNodeId, hlc) {
  const db = getDb();

  // 1. Check if ticket is already checked in and accepted
  const accepted = db
    .prepare("SELECT * FROM checkins WHERE ticket_id = ? AND result = 'accepted' LIMIT 1")
    .get(ticketId);

  if (accepted) {
    return {
      granted: false,
      reason: 'already_used',
      firstCheckedInAt: accepted.created_at,
      gateNodeId: accepted.gate_node_id,
    };
  }

  // 2. Check ticket_claims table (persisted across restarts)
  const existingClaim = db.prepare('SELECT * FROM ticket_claims WHERE ticket_id = ?').get(ticketId);

  if (!existingClaim) {
    db.prepare(
      `
      INSERT INTO ticket_claims (ticket_id, claimant_node_id, hlc, granted_at)
      VALUES (?, ?, ?, datetime('now'))
    `
    ).run(ticketId, claimantNodeId, hlc);
    return { granted: true, claimantNodeId };
  }

  // Idempotent: already granted to this exact claimant
  if (existingClaim.claimant_node_id === claimantNodeId) {
    return { granted: true, claimantNodeId };
  }

  // Conflict: compare HLCs. Lowest (HLC, nodeId) wins
  const cmp = HLC.compare(hlc, existingClaim.hlc);
  if (cmp < 0) {
    // New claimant has earlier HLC! Take over grant
    db.prepare(
      `
      UPDATE ticket_claims
      SET claimant_node_id = ?, hlc = ?, granted_at = datetime('now')
      WHERE ticket_id = ?
    `
    ).run(claimantNodeId, hlc, ticketId);
    return { granted: true, claimantNodeId };
  } else {
    return {
      granted: false,
      reason: 'higher_hlc',
      existingClaimant: existingClaim.claimant_node_id,
      existingHlc: existingClaim.hlc,
    };
  }
}

/**
 * Internal handler for incoming ticket claim requests from peer gates
 */
function handleTicketClaim({ ticketId, claimantNodeId, hlc }) {
  if (hlc) {
    hlcService.receive(hlc);
  }
  return grantClaimLocally(ticketId, claimantNodeId, hlc);
}

/**
 * Executes the distributed quorum claim protocol across gate nodes
 */
async function acquireGateQuorumClaim(ticketId) {
  const db = getDb();
  const peers = GATE_NODES.filter((nodeId) => nodeId !== config.nodeId);
  const majorityNeeded = Math.floor(GATE_NODES.length / 2) + 1; // 2 out of 3

  for (let attempt = 1; attempt <= MAX_CLAIM_RETRIES; attempt++) {
    const myHlc = hlcService.send().toString();

    // Local grant (this node counts as 1 acceptor)
    const localGrant = grantClaimLocally(ticketId, config.nodeId, myHlc);
    if (!localGrant.granted && localGrant.reason === 'already_used') {
      return {
        success: false,
        reason: 'already_used',
        firstCheckedInAt: localGrant.firstCheckedInAt,
        gateNodeId: localGrant.gateNodeId,
      };
    }

    let peerUnreachableCount = 0;
    let duplicateDetected = null;

    // Request remote grants in parallel
    const claimPromises = peers.map(async (peerId) => {
      try {
        const res = await peerTransport.post(
          peerId,
          '/internal/claim',
          {
            claimType: 'ticket',
            ticketId,
            claimantNodeId: config.nodeId,
            hlc: myHlc,
            attempt,
          },
          { timeoutMs: 1200 }
        );

        const claimData = res?.data || res || {};
        if (claimData.granted) {
          return { granted: true, peerId };
        } else if (claimData.reason === 'already_used') {
          return {
            granted: false,
            alreadyUsed: true,
            firstCheckedInAt: claimData.firstCheckedInAt,
            gateNodeId: claimData.gateNodeId,
          };
        }
        return { granted: false, reason: claimData.reason };
      } catch (err) {
        return { granted: false, unreachable: true, err: err.message };
      }
    });

    const results = await Promise.all(claimPromises);

    // Re-verify that local node still holds its own grant
    const currentLocalClaim = db
      .prepare('SELECT * FROM ticket_claims WHERE ticket_id = ?')
      .get(ticketId);
    const stillHoldsLocal =
      currentLocalClaim && currentLocalClaim.claimant_node_id === config.nodeId;
    let totalGrants = stillHoldsLocal ? 1 : 0;

    for (const r of results) {
      if (r.granted) {
        totalGrants++;
      } else if (r.alreadyUsed) {
        duplicateDetected = r;
      } else if (r.unreachable) {
        peerUnreachableCount++;
      }
    }

    if (duplicateDetected) {
      return {
        success: false,
        reason: 'already_used',
        firstCheckedInAt: duplicateDetected.firstCheckedInAt,
        gateNodeId: duplicateDetected.gateNodeId,
      };
    }

    if (totalGrants >= majorityNeeded) {
      return { success: true, grants: totalGrants, myHlc };
    }

    // If quorum unreachable due to peer network failures/partitions
    if (totalGrants + (peers.length - peerUnreachableCount) < majorityNeeded) {
      return {
        success: false,
        unreachable: true,
        reason: 'quorum_unreachable',
        grants: totalGrants,
      };
    }

    // Split vote: randomized backoff before retry
    if (attempt < MAX_CLAIM_RETRIES) {
      const backoffMs = 20 + Math.floor(Math.random() * 50);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  return { success: false, reason: 'quorum_not_reached' };
}

/**
 * Validates a scanned ticket and records check-in
 */
async function validateAndCheckin({ token, mode = 'online', offlineHlc = null }) {
  const startTime = Date.now();
  const db = getDb();

  // 1. Asymmetric offline token verification (Ed25519)
  const verification = tokenService.verify(token);
  if (!verification.valid) {
    logger.warn({ token: token.slice(0, 20) }, 'Invalid ticket token scanned');
    return {
      success: false,
      result: CHECKIN_RESULT.REJECTED_INVALID,
      error: verification.error || 'Signature verification failed: token is forged or tampered',
      latencyMs: Date.now() - startTime,
    };
  }

  const { ticketId, eventId } = verification;

  // 2. Check local database for existing ticket record and checkin status
  const localTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);

  // Rejection check: revoked ticket
  if (localTicket && localTicket.status === TICKET_STATUS.REVOKED) {
    logger.warn({ ticketId }, 'Scan rejected: Ticket has been revoked');
    return {
      success: false,
      result: 'revoked',
      ticketId,
      eventId,
      error: 'Ticket has been revoked',
      latencyMs: Date.now() - startTime,
    };
  }

  // Check event status if local event record exists
  const localEvent = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (
    localEvent &&
    (localEvent.status === EVENT_STATUS.CANCELLED || localEvent.status === EVENT_STATUS.CLOSED)
  ) {
    logger.warn(
      { ticketId, eventId, eventStatus: localEvent.status },
      'Scan rejected: Event closed or cancelled'
    );
    return {
      success: false,
      result: CHECKIN_RESULT.REJECTED_INVALID,
      ticketId,
      eventId,
      error: `Event is currently ${localEvent.status}`,
      latencyMs: Date.now() - startTime,
    };
  }

  // Rejection check: already checked in locally
  const localCheckin = db
    .prepare(
      "SELECT * FROM checkins WHERE ticket_id = ? AND result = 'accepted' ORDER BY created_at ASC LIMIT 1"
    )
    .get(ticketId);

  if (localCheckin) {
    logger.info(
      { ticketId, gateNodeId: localCheckin.gate_node_id },
      'Scan rejected: Already checked in locally'
    );
    return {
      success: false,
      result: CHECKIN_RESULT.REJECTED_DUPLICATE,
      ticketId,
      eventId,
      firstCheckedInAt: localCheckin.created_at,
      gateNodeId: localCheckin.gate_node_id,
      latencyMs: Date.now() - startTime,
    };
  }

  // 3. Online Quorum Claim Protocol vs Offline Mode
  let actualMode = mode;
  let finalHlc = offlineHlc;

  if (mode === CHECKIN_MODE.ONLINE) {
    const claimResult = await acquireGateQuorumClaim(ticketId);

    if (!claimResult.success) {
      if (claimResult.reason === 'already_used') {
        return {
          success: false,
          result: CHECKIN_RESULT.REJECTED_DUPLICATE,
          ticketId,
          eventId,
          firstCheckedInAt: claimResult.firstCheckedInAt,
          gateNodeId: claimResult.gateNodeId,
          latencyMs: Date.now() - startTime,
        };
      }

      // Quorum unreachable: check OFFLINE_POLICY
      const offlinePolicy = process.env.OFFLINE_POLICY || config.offlinePolicy || 'allow_flagged';
      if (claimResult.unreachable && offlinePolicy === 'allow_flagged') {
        logger.warn(
          { ticketId, offlinePolicy },
          'Gate quorum unreachable. Falling back to OFFLINE validation policy allow_flagged'
        );
        actualMode = CHECKIN_MODE.OFFLINE;
        finalHlc = hlcService.send().toString();
      } else {
        logger.warn({ ticketId, claimResult }, 'Gate quorum claim rejected');
        return {
          success: false,
          result: CHECKIN_RESULT.REJECTED_DUPLICATE,
          ticketId,
          eventId,
          error: 'Quorum consensus rejected claim or ticket already checked in',
          latencyMs: Date.now() - startTime,
        };
      }
    } else {
      finalHlc = claimResult.myHlc;
    }
  } else {
    finalHlc = offlineHlc || hlcService.send().toString();
  }

  // 4. Record Checkin and update ticket state atomically
  const checkinId = idService.generateId();
  finalHlc = finalHlc || hlcService.send().toString();

  const recordTx = db.transaction(() => {
    // 1. Ensure event exists to satisfy foreign key constraint during out-of-order delivery
    db.prepare(
      `
      INSERT INTO events (id, name, venue, starts_at, capacity, price, status, created_at)
      VALUES (?, 'Pending Replication Event', 'Campus Venue', datetime('now'), 1000, 0, 'on_sale', datetime('now'))
      ON CONFLICT(id) DO NOTHING
    `
    ).run(eventId);

    // 2. Ensure ticket exists before recording checkin (satisfies checkins -> tickets foreign key)
    if (!localTicket) {
      db.prepare(
        `
        INSERT INTO tickets (id, event_id, holder_name, holder_email, holder_phone, issued_by_node, issued_at_hlc, status, token, created_at)
        VALUES (?, ?, 'Scanned Attendee', '', '', ?, ?, 'used', ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET status = CASE WHEN tickets.status = 'revoked' THEN 'revoked' ELSE 'used' END
      `
      ).run(ticketId, eventId, config.nodeId, finalHlc, token);
    } else {
      db.prepare("UPDATE tickets SET status = 'used' WHERE id = ? AND status != 'revoked'").run(
        ticketId
      );
    }

    // 3. Insert checkin record
    db.prepare(
      `
      INSERT INTO checkins (id, ticket_id, gate_node_id, hlc, mode, result, resolved, created_at)
      VALUES (?, ?, ?, ?, ?, 'accepted', 0, datetime('now'))
    `
    ).run(checkinId, ticketId, config.nodeId, finalHlc, actualMode);

    // Write CHECKIN_RECORDED to op_log
    const op = {
      op_id: idService.generateId(),
      origin_node: config.nodeId,
      hlc: finalHlc,
      type: OP_TYPES.CHECKIN_RECORDED,
      payload_json: JSON.stringify({
        checkinId,
        ticketId,
        eventId,
        gateNodeId: config.nodeId,
        hlc: finalHlc,
        mode: actualMode,
        result: 'accepted',
      }),
    };

    db.prepare(
      `
      INSERT INTO op_log (op_id, origin_node, hlc, type, payload_json, applied_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `
    ).run(op.op_id, op.origin_node, op.hlc, op.type, op.payload_json);

    return op;
  });

  const writtenOp = recordTx();

  // 5. Broadcast op to cluster peers eagerly
  try {
    replicationService.notifyNewOp(writtenOp);
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to eagerly broadcast checkin op');
  }

  // 6. Broadcast Socket.IO event
  try {
    broadcastSocketEvent(SOCKET_EVENTS.CHECKIN_RESULT, {
      checkinId,
      ticketId,
      eventId,
      gateNodeId: config.nodeId,
      result: 'accepted',
      mode: actualMode,
      hlc: finalHlc,
      timestamp: new Date().toISOString(),
    });
  } catch (_e) {}

  const latencyMs = Date.now() - startTime;
  logger.info({ checkinId, ticketId, actualMode, latencyMs }, 'Check-in accepted');

  return {
    success: true,
    checkinId,
    ticketId,
    eventId,
    result: 'accepted',
    mode: actualMode,
    hlc: finalHlc,
    latencyMs,
  };
}

/**
 * Replays a batch of offline scans collected by gate device
 */
async function processOfflineBatch(scans) {
  const db = getDb();
  let processed = 0;
  let accepted = 0;
  const conflicts = [];

  // Sort scans by HLC ascending for causal replay
  const sortedScans = [...scans].sort((a, b) => HLC.compare(a.hlc, b.hlc));

  for (const scan of sortedScans) {
    processed++;
    const verification = tokenService.verify(scan.token);
    if (!verification.valid) {
      continue;
    }

    const { ticketId, eventId } = verification;
    hlcService.receive(scan.hlc);

    const existingAccepted = db
      .prepare("SELECT * FROM checkins WHERE ticket_id = ? AND result = 'accepted'")
      .all(ticketId);

    const checkinId = scan.checkinId || idService.generateId();

    if (existingAccepted.length === 0) {
      // First scan: accept
      db.prepare(
        `
        INSERT INTO checkins (id, ticket_id, gate_node_id, hlc, mode, result, resolved, created_at)
        VALUES (?, ?, ?, ?, 'offline', 'accepted', 0, coalesce(?, datetime('now')))
        ON CONFLICT(id) DO NOTHING
      `
      ).run(
        checkinId,
        ticketId,
        scan.gateNodeId || config.nodeId,
        scan.hlc,
        scan.scannedAt || null
      );

      db.prepare("UPDATE tickets SET status = 'used' WHERE id = ? AND status != 'revoked'").run(
        ticketId
      );
      accepted++;

      const op = {
        op_id: idService.generateId(),
        origin_node: config.nodeId,
        hlc: scan.hlc,
        type: OP_TYPES.CHECKIN_RECORDED,
        payload_json: JSON.stringify({
          checkinId,
          ticketId,
          eventId,
          gateNodeId: scan.gateNodeId || config.nodeId,
          hlc: scan.hlc,
          mode: 'offline',
          result: 'accepted',
        }),
      };

      db.prepare(
        `
        INSERT INTO op_log (op_id, origin_node, hlc, type, payload_json, applied_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `
      ).run(op.op_id, op.origin_node, op.hlc, op.type, op.payload_json);

      try {
        replicationService.notifyNewOp(op);
      } catch (_e) {}
    } else {
      // Conflict detected!
      const existing = existingAccepted[0];
      const isScanEarlier = HLC.compare(scan.hlc, existing.hlc) < 0;

      let winnerId;
      let loserId;
      let winnerGate;
      let loserGate;

      if (isScanEarlier) {
        winnerId = checkinId;
        loserId = existing.id;
        winnerGate = scan.gateNodeId || config.nodeId;
        loserGate = existing.gate_node_id;

        // Insert new scan as accepted
        db.prepare(
          `
          INSERT INTO checkins (id, ticket_id, gate_node_id, hlc, mode, result, resolved, created_at)
          VALUES (?, ?, ?, ?, 'offline', 'accepted', 0, coalesce(?, datetime('now')))
          ON CONFLICT(id) DO NOTHING
        `
        ).run(
          checkinId,
          ticketId,
          scan.gateNodeId || config.nodeId,
          scan.hlc,
          scan.scannedAt || null
        );

        // Update previous to rejected_duplicate
        db.prepare(
          "UPDATE checkins SET result = 'rejected_duplicate', resolved = 1 WHERE id = ?"
        ).run(existing.id);
      } else {
        winnerId = existing.id;
        loserId = checkinId;
        winnerGate = existing.gate_node_id;
        loserGate = scan.gateNodeId || config.nodeId;

        // Insert new scan as rejected_duplicate
        db.prepare(
          `
          INSERT INTO checkins (id, ticket_id, gate_node_id, hlc, mode, result, resolved, created_at)
          VALUES (?, ?, ?, ?, 'offline', 'rejected_duplicate', 1, coalesce(?, datetime('now')))
          ON CONFLICT(id) DO NOTHING
        `
        ).run(
          checkinId,
          ticketId,
          scan.gateNodeId || config.nodeId,
          scan.hlc,
          scan.scannedAt || null
        );
      }

      const conflictId = idService.generateId();
      const details = {
        reason: 'Offline concurrent check-in conflict',
        winnerGate,
        loserGate,
        winnerId,
        loserId,
      };

      db.prepare(
        `
        INSERT INTO conflicts (id, ticket_id, winner_checkin_id, loser_checkin_id, detected_at, details_json)
        VALUES (?, ?, ?, ?, datetime('now'), ?)
        ON CONFLICT(id) DO NOTHING
      `
      ).run(conflictId, ticketId, winnerId, loserId, JSON.stringify(details));

      db.prepare("UPDATE tickets SET fraud_alert = 1, status = 'used' WHERE id = ?").run(ticketId);

      conflicts.push({
        id: conflictId,
        ticketId,
        winnerCheckinId: winnerId,
        loserCheckinId: loserId,
        details,
      });

      try {
        broadcastSocketEvent(SOCKET_EVENTS.CONFLICT_DETECTED, {
          id: conflictId,
          ticketId,
          winnerCheckinId: winnerId,
          loserCheckinId: loserId,
          details,
          detectedAt: new Date().toISOString(),
        });
      } catch (_e) {}
    }
  }

  return {
    processed,
    accepted,
    conflicts,
  };
}

/**
 * Gate statistics aggregator
 */
function getGateStats(eventId = null) {
  const db = getDb();

  let query = 'SELECT result, COUNT(*) as count FROM checkins';
  const params = [];

  if (eventId) {
    query += ' WHERE ticket_id IN (SELECT id FROM tickets WHERE event_id = ?)';
    params.push(eventId);
  }
  query += ' GROUP BY result';

  const rows = db.prepare(query).all(...params);
  let enteredCount = 0;
  let duplicateBlocked = 0;
  let invalidAttempts = 0;

  for (const r of rows) {
    if (r.result === 'accepted') enteredCount = r.count;
    else if (r.result === 'rejected_duplicate') duplicateBlocked = r.count;
    else if (r.result === 'rejected_invalid') invalidAttempts = r.count;
  }

  // Per-event summary
  const perEvent = db
    .prepare(
      `
      SELECT e.id as eventId, e.name as eventName,
             SUM(CASE WHEN c.result = 'accepted' THEN 1 ELSE 0 END) as accepted,
             SUM(CASE WHEN c.result = 'rejected_duplicate' THEN 1 ELSE 0 END) as duplicates,
             COUNT(c.id) as totalCheckins
      FROM events e
      LEFT JOIN tickets t ON t.event_id = e.id
      LEFT JOIN checkins c ON c.ticket_id = t.id
      GROUP BY e.id
    `
    )
    .all();

  return {
    enteredCount,
    duplicateBlocked,
    invalidAttempts,
    totalScans: enteredCount + duplicateBlocked + invalidAttempts,
    perEvent,
  };
}

module.exports = {
  grantClaimLocally,
  handleTicketClaim,
  acquireGateQuorumClaim,
  validateAndCheckin,
  processOfflineBatch,
  getGateStats,
};
