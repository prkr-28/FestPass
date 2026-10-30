/**
 * Unit Tests: CRDT State-Machine Replication Engine (Stage 3)
 */

const Database = require('better-sqlite3');
const { OP_TYPES, TICKET_STATUS } = require('@festpass/shared');
const { applyOp, applyBatch } = require('../src/services/crdtEngine');
const { runMigrations } = require('../src/db/migrator');

describe('CRDT Apply Engine', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    db.prepare(
      `
      INSERT INTO events (id, name, venue, starts_at, capacity, price, status, created_at)
      VALUES ('evt_test', 'Test Fest', 'Test Arena', '2026-11-15T18:00:00Z', 300, 25, 'on_sale', datetime('now'))
      ON CONFLICT(id) DO NOTHING
    `
    ).run();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('idempotency: same op_id is never applied twice', () => {
    const op = {
      op_id: 'op_1001',
      origin_node: 'B1',
      hlc: '1793370000000:0:B1',
      type: OP_TYPES.TICKET_ISSUED,
      payload_json: JSON.stringify({
        ticketId: 't_1',
        eventId: 'evt_techfest_2026',
        holderName: 'Alice',
        holderEmail: 'alice@campus.edu',
        holderPhone: '+15551111111',
        status: 'valid',
        token: 'FP1.t_1.evt_techfest_2026.sig',
      }),
    };

    const first = applyOp(db, op);
    expect(first.applied).toBe(true);

    const second = applyOp(db, op);
    expect(second.applied).toBe(false);
    expect(second.reason).toBe('already_applied');

    // Confirm op_log only has 1 record
    const count = db.prepare('SELECT count(*) as c FROM op_log WHERE op_id = ?').get('op_1001').c;
    expect(count).toBe(1);
  });

  it('EVENT_UPSERT: last-writer-wins by HLC', () => {
    // Op 1 with lower HLC
    const op1 = {
      op_id: 'op_e1',
      origin_node: 'B1',
      hlc: '1793370010000:0:B1',
      type: OP_TYPES.EVENT_UPSERT,
      payload_json: JSON.stringify({
        event: {
          id: 'evt_test',
          name: 'Old Event Name',
          venue: 'Old Hall',
          starts_at: '2026-11-01T10:00:00Z',
          capacity: 100,
          price: 10,
          status: 'draft',
        },
        quotas: [{ event_id: 'evt_test', node_id: 'B1', quota: 50, sold: 0 }],
        isUpdate: false,
      }),
    };

    // Op 2 with higher HLC
    const op2 = {
      op_id: 'op_e2',
      origin_node: 'B2',
      hlc: '1793370020000:0:B2',
      type: OP_TYPES.EVENT_UPSERT,
      payload_json: JSON.stringify({
        event: {
          id: 'evt_test',
          name: 'Updated Event Name (Winner)',
          venue: 'Grand Arena',
          starts_at: '2026-11-01T12:00:00Z',
          capacity: 150,
          price: 15,
          status: 'on_sale',
        },
        quotas: [{ event_id: 'evt_test', node_id: 'B1', quota: 75, sold: 0 }],
        isUpdate: true,
      }),
    };

    applyOp(db, op1);
    let event = db.prepare('SELECT * FROM events WHERE id = ?').get('evt_test');
    expect(event.name).toBe('Old Event Name');

    // Newer op wins
    applyOp(db, op2);
    event = db.prepare('SELECT * FROM events WHERE id = ?').get('evt_test');
    expect(event.name).toBe('Updated Event Name (Winner)');
    expect(event.capacity).toBe(150);

    // Stale/older op arriving out of order is rejected by LWW
    const opStale = {
      op_id: 'op_e0',
      origin_node: 'B3',
      hlc: '1793370005000:0:B3', // older than op2
      type: OP_TYPES.EVENT_UPSERT,
      payload_json: JSON.stringify({
        event: {
          id: 'evt_test',
          name: 'Stale Event Name (Should Not Overwrite)',
          venue: 'Stale Hall',
          starts_at: '2026-11-01T10:00:00Z',
          capacity: 50,
          price: 5,
          status: 'draft',
        },
        isUpdate: true,
      }),
    };

    applyOp(db, opStale);
    event = db.prepare('SELECT * FROM events WHERE id = ?').get('evt_test');
    expect(event.name).toBe('Updated Event Name (Winner)'); // Still winner!
  });

  it('TICKET_ISSUED: add-only set persists ticket to tickets table', () => {
    const op = {
      op_id: 'op_t1',
      origin_node: 'B1',
      hlc: '1793370030000:0:B1',
      type: OP_TYPES.TICKET_ISSUED,
      payload_json: JSON.stringify({
        ticketId: 't_200',
        eventId: 'evt_test',
        holderName: 'Bob',
        holderEmail: 'bob@campus.edu',
        holderPhone: '+15552222222',
        issuedByNode: 'B1',
        status: 'valid',
        token: 'FP1.t_200.evt_test.sig',
        issuedAtHlc: '1793370030000:0:B1',
      }),
    };

    applyOp(db, op);
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get('t_200');
    expect(ticket).toBeDefined();
    expect(ticket.holder_name).toBe('Bob');
    expect(ticket.status).toBe(TICKET_STATUS.VALID);
  });

  it('TICKET_REVOKED: permanently wins over valid even if arriving out of order', () => {
    // Revocation arrives first (e.g. out of order network delivery)
    const revokeOp = {
      op_id: 'op_rev_1',
      origin_node: 'B1',
      hlc: '1793370050000:0:B1',
      type: OP_TYPES.TICKET_REVOKED,
      payload_json: JSON.stringify({
        ticketId: 't_300',
        eventId: 'evt_test',
        reason: 'Refunded by admin',
        revokedAtHlc: '1793370050000:0:B1',
      }),
    };

    applyOp(db, revokeOp);
    let ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get('t_300');
    expect(ticket).toBeDefined();
    expect(ticket.status).toBe(TICKET_STATUS.REVOKED);

    // Later, delayed TICKET_ISSUED arrives
    const issueOp = {
      op_id: 'op_iss_1',
      origin_node: 'B1',
      hlc: '1793370040000:0:B1',
      type: OP_TYPES.TICKET_ISSUED,
      payload_json: JSON.stringify({
        ticketId: 't_300',
        eventId: 'evt_test',
        holderName: 'Charlie',
        holderEmail: 'charlie@campus.edu',
        holderPhone: '+15553333333',
        status: 'valid',
        token: 'FP1.t_300.evt_test.sig',
      }),
    };

    applyOp(db, issueOp);
    ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get('t_300');
    expect(ticket.status).toBe(TICKET_STATUS.REVOKED); // Must remain revoked!
  });

  it('CHECKIN_RECORDED: executes Stage 4 extension hook and marks ticket used', () => {
    // 1. Issue a valid ticket
    db.prepare(
      `
      INSERT INTO tickets (id, event_id, holder_name, holder_email, holder_phone, issued_by_node, issued_at_hlc, status, token, created_at)
      VALUES ('t_400', 'evt_test', 'Dave', 'dave@campus.edu', '+15554444444', 'B1', '1793370000000:0:B1', 'valid', 'FP1.t_400...', datetime('now'))
    `
    ).run();

    // 2. Checkin operation arrives from Gate G1
    const checkinOp = {
      op_id: 'op_chk_1',
      origin_node: 'G1',
      hlc: '1793370060000:0:G1',
      type: OP_TYPES.CHECKIN_RECORDED,
      payload_json: JSON.stringify({
        checkinId: 'chk_101',
        ticketId: 't_400',
        gateNodeId: 'G1',
        hlc: '1793370060000:0:G1',
        mode: 'online',
        result: 'accepted',
      }),
    };

    applyOp(db, checkinOp);

    const checkin = db.prepare('SELECT * FROM checkins WHERE id = ?').get('chk_101');
    expect(checkin).toBeDefined();
    expect(checkin.result).toBe('accepted');

    const ticket = db.prepare('SELECT status FROM tickets WHERE id = ?').get('t_400');
    expect(ticket.status).toBe(TICKET_STATUS.USED);
  });

  it('applyBatch: orders batch by HLC ascending before applying', () => {
    const ops = [
      {
        op_id: 'op_b2',
        origin_node: 'B1',
        hlc: '1793370020000:0:B1',
        type: OP_TYPES.TICKET_ISSUED,
        payload_json: JSON.stringify({
          ticketId: 't_batch_2',
          eventId: 'evt_test',
          holderName: 'Second',
          holderEmail: '2@campus.edu',
          holderPhone: '+15550000002',
          status: 'valid',
          token: 'sig2',
        }),
      },
      {
        op_id: 'op_b1',
        origin_node: 'B1',
        hlc: '1793370010000:0:B1',
        type: OP_TYPES.TICKET_ISSUED,
        payload_json: JSON.stringify({
          ticketId: 't_batch_1',
          eventId: 'evt_test',
          holderName: 'First',
          holderEmail: '1@campus.edu',
          holderPhone: '+15550000001',
          status: 'valid',
          token: 'sig1',
        }),
      },
    ];

    const result = applyBatch(db, ops);
    expect(result.appliedCount).toBe(2);

    const appliedOps = db.prepare('SELECT op_id FROM op_log ORDER BY hlc ASC').all();
    expect(appliedOps[0].op_id).toBe('op_b1');
    expect(appliedOps[1].op_id).toBe('op_b2');
  });
});
