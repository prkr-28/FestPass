const request = require('supertest');
const jwt = require('jsonwebtoken');
const http = require('http');
const { createApp } = require('../src/app');
const { getDb } = require('../src/db');
const config = require('../src/config');

describe('Quota Borrowing & Oversell Prevention', () => {
  const app = createApp();

  const adminToken = jwt.sign(
    { id: 'u_admin', name: 'Admin', email: 'admin@campus.edu', role: 'admin' },
    config.jwtSecret
  );

  let borrowEventId;

  beforeAll(async () => {
    // Create an event with quotas: B1 has 5, B2 has 50
    const res = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Borrow Test Event',
        venue: 'Quad Arena',
        startsAt: '2026-12-25T18:00:00.000Z',
        capacity: 100,
        quotas: {
          [config.nodeId]: 10,
          B2: 50,
          B3: 40,
        },
      });

    borrowEventId = res.body.event.id;
  });

  it('lender node atomically reduces its quota when receiving borrow request from peer', async () => {
    const db = getDb();
    const initialQuota = db
      .prepare('SELECT quota, sold FROM booth_quotas WHERE event_id = ? AND node_id = ?')
      .get(borrowEventId, config.nodeId);

    expect(initialQuota.quota).toBe(10);

    // Call /internal/quota/borrow as a peer requesting quota from this node
    const res = await request(app).post('/internal/quota/borrow').send({
      eventId: borrowEventId,
      requesterNodeId: 'B2',
      amount: 4,
    });

    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(true);
    expect(res.body.transferred).toBe(4);
    expect(res.body.newQuota).toBe(6);

    // Confirm in DB that this node's quota decreased
    const updatedQuota = db
      .prepare('SELECT quota, sold FROM booth_quotas WHERE event_id = ? AND node_id = ?')
      .get(borrowEventId, config.nodeId);
    expect(updatedQuota.quota).toBe(6);
  });

  it('lender node rejects or caps borrow when available quota is exhausted', async () => {
    const db = getDb();
    // Simulate node has sold all its remaining quota (6 sold of 6)
    db.prepare('UPDATE booth_quotas SET sold = 6 WHERE event_id = ? AND node_id = ?').run(
      borrowEventId,
      config.nodeId
    );

    const res = await request(app).post('/internal/quota/borrow').send({
      eventId: borrowEventId,
      requesterNodeId: 'B2',
      amount: 5,
    });

    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(false);
    expect(res.body.transferred).toBe(0);

    // Reset sold count for further tests
    db.prepare('UPDATE booth_quotas SET sold = 0 WHERE event_id = ? AND node_id = ?').run(
      borrowEventId,
      config.nodeId
    );
  });

  it('initiator returns 503 PEER_UNREACHABLE with clear description when peer booth is unreachable', async () => {
    // Attempting to borrow from an unroutable / down peer node
    // Configure peers table entry pointing to a closed port
    const db = getDb();
    db.prepare(
      `
      INSERT INTO peers (node_id, url, role, status)
      VALUES ('B3', 'http://127.0.0.1:59999', 'booth', 'healthy')
      ON CONFLICT(node_id) DO UPDATE SET url = excluded.url
    `
    ).run();

    const res = await request(app).post('/internal/quota/borrow').send({
      eventId: borrowEventId,
      targetNodeId: 'B3',
      amount: 10,
    });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('PEER_UNREACHABLE');
    expect(res.body.error.message).toMatch(/unreachable for quota borrow/i);
  });

  it('initiator successfully increases local quota when peer approves borrow', async () => {
    // Spin up an ephemeral peer HTTP server representing Booth B2
    const peerServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        expect(parsed.eventId).toBe(borrowEventId);
        expect(parsed.requesterNodeId).toBe(config.nodeId);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            approved: true,
            transferred: parsed.amount,
            newQuota: 35,
          })
        );
      });
    });

    await new Promise((resolve) => peerServer.listen(0, '127.0.0.1', resolve));
    const peerPort = peerServer.address().port;

    const db = getDb();
    db.prepare(
      `
      INSERT INTO peers (node_id, url, role, status)
      VALUES ('B2', ?, 'booth', 'healthy')
      ON CONFLICT(node_id) DO UPDATE SET url = excluded.url
    `
    ).run(`http://127.0.0.1:${peerPort}`);

    try {
      const beforeBorrow = db
        .prepare('SELECT quota FROM booth_quotas WHERE event_id = ? AND node_id = ?')
        .get(borrowEventId, config.nodeId).quota;

      const res = await request(app).post('/internal/quota/borrow').send({
        eventId: borrowEventId,
        targetNodeId: 'B2',
        amount: 15,
      });

      expect(res.status).toBe(200);
      expect(res.body.approved).toBe(true);
      expect(res.body.transferred).toBe(15);

      const afterBorrow = db
        .prepare('SELECT quota FROM booth_quotas WHERE event_id = ? AND node_id = ?')
        .get(borrowEventId, config.nodeId).quota;

      expect(afterBorrow).toBe(beforeBorrow + 15);
    } finally {
      await new Promise((resolve) => peerServer.close(resolve));
    }
  });

  it('POST /internal/claim follows contract 8.3 specification', async () => {
    // When targetNodeId is the current node, it transfers from local quota
    const res = await request(app).post('/internal/claim').send({
      eventId: borrowEventId,
      targetNodeId: config.nodeId,
      amount: 2,
    });

    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(true);
    expect(res.body.transferred).toBe(2);
  });
});
