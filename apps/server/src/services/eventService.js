/**
 * Event Management Service
 *
 * Provides single-point event creation & updates with:
 * - Distributed quota partitioning across booth nodes (B1, B2, B3)
 * - State-machine replication log recording (EVENT_UPSERT) with HLC timestamps
 */

const { CLUSTER_NODES, NODE_ROLES, OP_TYPES, ERROR_CODES } = require('@festpass/shared');
const config = require('../config');
const { getDb } = require('../db');
const idService = require('./idService');
const hlcService = require('./hlcService');
const { AppError } = require('../middleware/errorHandler');

/**
 * Returns default booth node IDs in cluster
 */
function getBoothNodeIds() {
  const booths = CLUSTER_NODES.filter(
    (n) => n.role === NODE_ROLES.BOOTH || n.role === NODE_ROLES.BOTH
  ).map((n) => n.nodeId);
  return booths.length > 0 ? booths : ['B1', 'B2', 'B3'];
}

/**
 * Partition capacity across booth nodes
 * E.g., 300 over 3 booths = 100 each, remainder to the first.
 */
function partitionQuotas(capacity, customQuotas = null) {
  const boothNodes = getBoothNodeIds();
  const quotaMap = {};

  if (customQuotas && typeof customQuotas === 'object') {
    let totalAssigned = 0;
    for (const node of boothNodes) {
      const q = typeof customQuotas[node] === 'number' ? customQuotas[node] : 0;
      quotaMap[node] = q;
      totalAssigned += q;
    }
    if (totalAssigned > capacity) {
      throw new AppError(
        `Total custom quota (${totalAssigned}) exceeds event capacity (${capacity})`,
        400,
        ERROR_CODES.BAD_REQUEST
      );
    }
    return quotaMap;
  }

  const count = boothNodes.length;
  const perBooth = Math.floor(capacity / count);
  const remainder = capacity % count;

  boothNodes.forEach((node, index) => {
    quotaMap[node] = perBooth + (index === 0 ? remainder : 0);
  });

  return quotaMap;
}

/**
 * Single service function to create or update an event and write EVENT_UPSERT op_log
 */
function upsertEvent(eventData, existingId = null) {
  const db = getDb();

  const isUpdate = Boolean(existingId);
  let eventId = existingId;

  const result = db.transaction(() => {
    let eventRecord;

    if (isUpdate) {
      const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
      if (!existing) {
        throw new AppError(`Event with id '${eventId}' not found`, 404, ERROR_CODES.NOT_FOUND);
      }

      const name = eventData.name !== undefined ? eventData.name : existing.name;
      const venue = eventData.venue !== undefined ? eventData.venue : existing.venue;
      const startsAt =
        eventData.startsAt !== undefined
          ? eventData.startsAt
          : eventData.starts_at !== undefined
            ? eventData.starts_at
            : existing.starts_at;
      const capacity = eventData.capacity !== undefined ? eventData.capacity : existing.capacity;
      const price = eventData.price !== undefined ? eventData.price : existing.price;
      const status = eventData.status !== undefined ? eventData.status : existing.status;

      db.prepare(
        `UPDATE events
         SET name = ?, venue = ?, starts_at = ?, capacity = ?, price = ?, status = ?
         WHERE id = ?`
      ).run(name, venue, startsAt, capacity, price, status, eventId);

      // If custom quotas provided or capacity adjusted, update quotas
      if (eventData.quotas || (eventData.capacity && eventData.capacity !== existing.capacity)) {
        const quotaMap = partitionQuotas(capacity, eventData.quotas);
        const updateQuotaStmt = db.prepare(`
          INSERT INTO booth_quotas (event_id, node_id, quota, sold)
          VALUES (?, ?, ?, 0)
          ON CONFLICT(event_id, node_id) DO UPDATE SET quota = excluded.quota
        `);
        for (const [nodeId, quota] of Object.entries(quotaMap)) {
          updateQuotaStmt.run(eventId, nodeId, quota);
        }
      }

      eventRecord = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    } else {
      eventId = eventData.id || idService.generateId();
      const startsAt = eventData.startsAt || eventData.starts_at;
      const price = eventData.price !== undefined ? eventData.price : 0.0;
      const status = eventData.status || 'active';

      db.prepare(
        `INSERT INTO events (id, name, venue, starts_at, capacity, price, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(eventId, eventData.name, eventData.venue, startsAt, eventData.capacity, price, status);

      const quotaMap = partitionQuotas(eventData.capacity, eventData.quotas);
      const insertQuota = db.prepare(
        'INSERT INTO booth_quotas (event_id, node_id, quota, sold) VALUES (?, ?, ?, 0)'
      );

      for (const [nodeId, quota] of Object.entries(quotaMap)) {
        insertQuota.run(eventId, nodeId, quota);
      }

      eventRecord = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    }

    const quotas = db.prepare('SELECT * FROM booth_quotas WHERE event_id = ?').all(eventId);

    // Write op_log entry with HLC timestamp
    const hlc = hlcService.send().toString();
    const opId = idService.generateId();
    const payload = JSON.stringify({
      event: eventRecord,
      quotas,
      isUpdate,
    });

    db.prepare(
      `INSERT INTO op_log (op_id, origin_node, hlc, type, payload_json, applied_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(opId, config.nodeId, hlc, OP_TYPES.EVENT_UPSERT, payload);

    return { event: eventRecord, quotas };
  })();

  return result;
}

/**
 * List events with pagination and search
 */
function listEvents({ page = 1, limit = 20, search = '', status = null } = {}) {
  const db = getDb();
  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (parsedPage - 1) * parsedLimit;

  let whereClauses = [];
  let params = [];

  if (status) {
    whereClauses.push('status = ?');
    params.push(status);
  }

  if (search && search.trim().length > 0) {
    whereClauses.push('(name LIKE ? OR venue LIKE ?)');
    const searchTerm = `%${search.trim()}%`;
    params.push(searchTerm, searchTerm);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM events ${whereSql}`).get(...params);
  const total = countRow ? countRow.count : 0;
  const totalPages = Math.ceil(total / parsedLimit);

  const events = db
    .prepare(
      `SELECT * FROM events
       ${whereSql}
       ORDER BY starts_at ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, parsedLimit, offset);

  // Attach quotas to events
  const getQuotas = db.prepare('SELECT * FROM booth_quotas WHERE event_id = ?');
  const enrichedEvents = events.map((ev) => ({
    ...ev,
    quotas: getQuotas.all(ev.id),
  }));

  return {
    events: enrichedEvents,
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total,
      totalPages,
    },
  };
}

/**
 * Get event by ID with quotas
 */
function getEventById(eventId) {
  const db = getDb();
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return null;

  const quotas = db.prepare('SELECT * FROM booth_quotas WHERE event_id = ?').all(eventId);
  return { ...event, quotas };
}

/**
 * Delete event by ID (Admin only)
 */
function deleteEvent(eventId) {
  const db = getDb();
  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!existing) {
      throw new AppError('Event not found', 404, ERROR_CODES.NOT_FOUND);
    }
    db.prepare('DELETE FROM booth_quotas WHERE event_id = ?').run(eventId);
    db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
    return true;
  })();
}

module.exports = {
  upsertEvent,
  listEvents,
  getEventById,
  deleteEvent,
  partitionQuotas,
  getBoothNodeIds,
};
