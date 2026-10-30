/**
 * Convergence, Partition-Heal, and Anti-Entropy Catch-Up Tests (Stage 3)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { OP_TYPES } from '@festpass/shared';
import { runMigrations } from '../src/db/migrator';
import { applyBatch } from '../src/services/crdtEngine';
import { ReplicationService } from '../src/services/replicationService';

/**
 * Computes an MD5 checksum of a table's ordered rows for convergence verification
 */
function computeTableChecksum(db, tableName, orderBy = 'id') {
  const rows = db.prepare(`SELECT * FROM ${tableName} ORDER BY ${orderBy} ASC`).all();
  const hash = crypto.createHash('md5');
  hash.update(JSON.stringify(rows));
  return { checksum: hash.digest('hex'), count: rows.length, rows };
}

describe('Cluster Convergence & Partition-Heal (Stage 3)', () => {
  let dbB1;
  let dbB2;
  let dbB3;

  beforeEach(() => {
    // 3 isolated SQLite database instances simulating 3 distinct physical nodes
    dbB1 = new Database(':memory:');
    dbB2 = new Database(':memory:');
    dbB3 = new Database(':memory:');

    runMigrations(dbB1);
    runMigrations(dbB2);
    runMigrations(dbB3);

    // Initial common event across all nodes
    const initialEventSql = `
      INSERT INTO events (id, name, venue, starts_at, capacity, price, status, created_at)
      VALUES ('evt_techfest_2026', 'Annual TechFest 2026', 'Main Hall', '2026-11-15T18:00:00Z', 300, 25, 'on_sale', datetime('now'))
    `;
    dbB1.exec(initialEventSql);
    dbB2.exec(initialEventSql);
    dbB3.exec(initialEventSql);
  });

  afterEach(() => {
    if (dbB1) dbB1.close();
    if (dbB2) dbB2.close();
    if (dbB3) dbB3.close();
  });

  it('convergence test: 3 booth nodes write concurrently, all DBs reach identical checksums', () => {
    // 1. Simulate concurrent ticket issuance on Node B1
    const opB1 = {
      op_id: 'op_b1_001',
      origin_node: 'B1',
      hlc: '1793370001000:0:B1',
      type: OP_TYPES.TICKET_ISSUED,
      payload_json: JSON.stringify({
        ticketId: 't_b1_1',
        eventId: 'evt_techfest_2026',
        holderName: 'Alice (B1)',
        holderEmail: 'alice@campus.edu',
        holderPhone: '+15551000001',
        issuedByNode: 'B1',
        status: 'valid',
        token: 'token_b1_1',
        issuedAtHlc: '1793370001000:0:B1',
      }),
    };
    applyBatch(dbB1, [opB1]);

    // 2. Simulate concurrent ticket issuance on Node B2
    const opB2 = {
      op_id: 'op_b2_001',
      origin_node: 'B2',
      hlc: '1793370002000:0:B2',
      type: OP_TYPES.TICKET_ISSUED,
      payload_json: JSON.stringify({
        ticketId: 't_b2_1',
        eventId: 'evt_techfest_2026',
        holderName: 'Bob (B2)',
        holderEmail: 'bob@campus.edu',
        holderPhone: '+15551000002',
        issuedByNode: 'B2',
        status: 'valid',
        token: 'token_b2_1',
        issuedAtHlc: '1793370002000:0:B2',
      }),
    };
    applyBatch(dbB2, [opB2]);

    // 3. Simulate concurrent ticket issuance & event update on Node B3
    const opB3_ticket = {
      op_id: 'op_b3_001',
      origin_node: 'B3',
      hlc: '1793370003000:0:B3',
      type: OP_TYPES.TICKET_ISSUED,
      payload_json: JSON.stringify({
        ticketId: 't_b3_1',
        eventId: 'evt_techfest_2026',
        holderName: 'Charlie (B3)',
        holderEmail: 'charlie@campus.edu',
        holderPhone: '+15551000003',
        issuedByNode: 'B3',
        status: 'valid',
        token: 'token_b3_1',
        issuedAtHlc: '1793370003000:0:B3',
      }),
    };

    const opB3_event = {
      op_id: 'op_b3_002',
      origin_node: 'B3',
      hlc: '1793370004000:0:B3',
      type: OP_TYPES.EVENT_UPSERT,
      payload_json: JSON.stringify({
        event: {
          id: 'evt_techfest_2026',
          name: 'Annual TechFest 2026 - Sold Out Soon!',
          venue: 'Main Auditorium Arena',
          starts_at: '2026-11-15T18:00:00Z',
          capacity: 450,
          price: 30,
          status: 'on_sale',
        },
        quotas: [],
        isUpdate: true,
      }),
    };
    applyBatch(dbB3, [opB3_ticket, opB3_event]);

    // Before replication: DBs are disjoint
    expect(dbB1.prepare('SELECT count(*) as c FROM tickets').get().c).toBe(1);
    expect(dbB2.prepare('SELECT count(*) as c FROM tickets').get().c).toBe(1);
    expect(dbB3.prepare('SELECT count(*) as c FROM tickets').get().c).toBe(1);

    // 4. State-Machine Replication: exchange all ops among nodes
    const allOps = [opB1, opB2, opB3_ticket, opB3_event];
    applyBatch(dbB1, allOps);
    applyBatch(dbB2, allOps);
    applyBatch(dbB3, allOps);

    // 5. Verification: All 3 databases must have identical records and checksums
    const b1Tickets = computeTableChecksum(dbB1, 'tickets');
    const b2Tickets = computeTableChecksum(dbB2, 'tickets');
    const b3Tickets = computeTableChecksum(dbB3, 'tickets');

    expect(b1Tickets.count).toBe(3);
    expect(b2Tickets.count).toBe(3);
    expect(b3Tickets.count).toBe(3);

    expect(b1Tickets.checksum).toBe(b2Tickets.checksum);
    expect(b2Tickets.checksum).toBe(b3Tickets.checksum);

    const b1Events = computeTableChecksum(dbB1, 'events');
    const b2Events = computeTableChecksum(dbB2, 'events');
    const b3Events = computeTableChecksum(dbB3, 'events');

    expect(b1Events.checksum).toBe(b2Events.checksum);
    expect(b2Events.checksum).toBe(b3Events.checksum);
    expect(b1Events.rows[0].name).toBe('Annual TechFest 2026 - Sold Out Soon!');
  });

  it('partition and heal test: write on partitioned sides, heal, verify convergence', () => {
    // Partition: [B1] || [B2, B3]
    // 1. Write on B1 side
    const opPartB1 = {
      op_id: 'op_part_b1',
      origin_node: 'B1',
      hlc: '1793370010000:0:B1',
      type: OP_TYPES.TICKET_ISSUED,
      payload_json: JSON.stringify({
        ticketId: 't_isolated_b1',
        eventId: 'evt_techfest_2026',
        holderName: 'Isolated Student B1',
        holderEmail: 'iso1@campus.edu',
        holderPhone: '+15559990001',
        issuedByNode: 'B1',
        status: 'valid',
        token: 'token_part_b1',
        issuedAtHlc: '1793370010000:0:B1',
      }),
    };
    applyBatch(dbB1, [opPartB1]);

    // 2. Write on B2/B3 side (replicated between B2 and B3)
    const opPartB2 = {
      op_id: 'op_part_b2',
      origin_node: 'B2',
      hlc: '1793370011000:0:B2',
      type: OP_TYPES.TICKET_ISSUED,
      payload_json: JSON.stringify({
        ticketId: 't_isolated_b2',
        eventId: 'evt_techfest_2026',
        holderName: 'Connected Student B2',
        holderEmail: 'conn2@campus.edu',
        holderPhone: '+15559990002',
        issuedByNode: 'B2',
        status: 'valid',
        token: 'token_part_b2',
        issuedAtHlc: '1793370011000:0:B2',
      }),
    };
    applyBatch(dbB2, [opPartB2]);
    applyBatch(dbB3, [opPartB2]);

    // While partitioned: B1 does not have B2's ticket, and B2 does not have B1's ticket
    expect(dbB1.prepare("SELECT count(*) as c FROM tickets WHERE id = 't_isolated_b2'").get().c).toBe(0);
    expect(dbB2.prepare("SELECT count(*) as c FROM tickets WHERE id = 't_isolated_b1'").get().c).toBe(0);

    // 3. Heal Partition: Anti-entropy synchronizes state across partition boundary
    const opsFromB1 = dbB1.prepare('SELECT * FROM op_log').all();
    const opsFromB2 = dbB2.prepare('SELECT * FROM op_log').all();

    applyBatch(dbB1, opsFromB2);
    applyBatch(dbB2, opsFromB1);
    applyBatch(dbB3, opsFromB1);

    // 4. Verify post-healing convergence: All databases match perfectly
    const cs1 = computeTableChecksum(dbB1, 'tickets');
    const cs2 = computeTableChecksum(dbB2, 'tickets');
    const cs3 = computeTableChecksum(dbB3, 'tickets');

    expect(cs1.count).toBe(2);
    expect(cs2.count).toBe(2);
    expect(cs3.count).toBe(2);

    expect(cs1.checksum).toBe(cs2.checksum);
    expect(cs2.checksum).toBe(cs3.checksum);
  });

  it('node catch-up: a newly restarted node fetches missing ops and converges', () => {
    // Node B1 issues multiple tickets over time
    const ops = [
      {
        op_id: 'op_catch_1',
        origin_node: 'B1',
        hlc: '1793370020000:0:B1',
        type: OP_TYPES.TICKET_ISSUED,
        payload_json: JSON.stringify({
          ticketId: 't_c1',
          eventId: 'evt_techfest_2026',
          holderName: 'Catchup 1',
          holderEmail: 'c1@campus.edu',
          holderPhone: '+15550001111',
          issuedByNode: 'B1',
          status: 'valid',
          token: 'tok_c1',
        }),
      },
      {
        op_id: 'op_catch_2',
        origin_node: 'B1',
        hlc: '1793370021000:0:B1',
        type: OP_TYPES.TICKET_ISSUED,
        payload_json: JSON.stringify({
          ticketId: 't_c2',
          eventId: 'evt_techfest_2026',
          holderName: 'Catchup 2',
          holderEmail: 'c2@campus.edu',
          holderPhone: '+15550002222',
          issuedByNode: 'B1',
          status: 'valid',
          token: 'tok_c2',
        }),
      },
    ];

    applyBatch(dbB1, ops);

    // Node G1 starts up fresh with an empty tickets table
    const dbG1 = new Database(':memory:');
    runMigrations(dbG1);

    expect(dbG1.prepare('SELECT count(*) as c FROM tickets').get().c).toBe(0);

    // G1 requests anti-entropy sync with its empty version vector {}
    const missingOps = dbB1.prepare('SELECT * FROM op_log ORDER BY hlc ASC').all();
    applyBatch(dbG1, missingOps);

    // G1 has fully caught up
    const g1Checksum = computeTableChecksum(dbG1, 'tickets');
    const b1Checksum = computeTableChecksum(dbB1, 'tickets');

    expect(g1Checksum.count).toBe(2);
    expect(g1Checksum.checksum).toBe(b1Checksum.checksum);

    dbG1.close();
  });
});
