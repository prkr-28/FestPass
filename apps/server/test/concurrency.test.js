const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const { getDb } = require('../src/db');
const config = require('../src/config');
const { OP_TYPES } = require('@festpass/shared');

describe('Concurrency & Quota Oversell Prevention', () => {
  const app = createApp();

  const adminToken = jwt.sign(
    { id: 'u_admin', name: 'Admin', email: 'admin@campus.edu', role: 'admin' },
    config.jwtSecret
  );

  const boothToken = jwt.sign(
    { id: 'u_booth', name: 'Booth Staff', email: 'booth@campus.edu', role: 'booth_staff' },
    config.jwtSecret
  );

  it('guarantees zero overselling under 200 concurrent requests on one booth node', async () => {
    // 1. Create an event with exact quota of 40 on current node B1
    const EXACT_QUOTA = 40;
    const TOTAL_REQUESTS = 200;

    const createRes = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Concurrent High-Load Flash Sale',
        venue: 'Campus Arena',
        startsAt: '2026-12-20T20:00:00.000Z',
        capacity: 100,
        price: 50.0,
        quotas: {
          [config.nodeId]: EXACT_QUOTA,
          B2: 30,
          B3: 30,
        },
      });

    expect(createRes.status).toBe(201);
    const eventId = createRes.body.event.id;

    // Verify initial quota state
    const db = getDb();
    const initialQuota = db
      .prepare('SELECT quota, sold FROM booth_quotas WHERE event_id = ? AND node_id = ?')
      .get(eventId, config.nodeId);
    expect(initialQuota.quota).toBe(EXACT_QUOTA);
    expect(initialQuota.sold).toBe(0);

    // 2. Fire 200 concurrent ticket sale requests simultaneously
    const concurrentRequests = Array.from({ length: TOTAL_REQUESTS }, (_, idx) =>
      request(app)
        .post('/tickets')
        .set('Authorization', `Bearer ${boothToken}`)
        .send({
          eventId,
          holderName: `Flash Buyer ${idx}`,
          holderEmail: `flash_buyer_${idx}_${Date.now()}@test.edu`,
          holderPhone: `+1999${String(idx).padStart(6, '0')}`,
        })
    );

    const responses = await Promise.all(concurrentRequests);

    // 3. Analyze responses
    const successful = responses.filter((r) => r.status === 201);
    const rejectedOverQuota = responses.filter((r) => r.status === 409);
    const otherErrors = responses.filter((r) => r.status !== 201 && r.status !== 409);

    expect(otherErrors.length).toBe(0);
    expect(successful.length).toBe(EXACT_QUOTA);
    expect(rejectedOverQuota.length).toBe(TOTAL_REQUESTS - EXACT_QUOTA);

    // Verify that every rejection returned OVER_QUOTA error code
    for (const r of rejectedOverQuota) {
      expect(r.body.success).toBe(false);
      expect(r.body.error.code).toBe('OVER_QUOTA');
    }

    // 4. Verify SQLite state integrity
    const finalQuota = db
      .prepare('SELECT quota, sold FROM booth_quotas WHERE event_id = ? AND node_id = ?')
      .get(eventId, config.nodeId);

    // Sold count MUST strictly equal EXACT_QUOTA and NEVER exceed it
    expect(finalQuota.sold).toBe(EXACT_QUOTA);
    expect(finalQuota.sold).toBeLessThanOrEqual(finalQuota.quota);

    // Verify actual stored tickets count matches EXACT_QUOTA
    const ticketsCount = db
      .prepare('SELECT COUNT(*) as count FROM tickets WHERE event_id = ?')
      .get(eventId).count;
    expect(ticketsCount).toBe(EXACT_QUOTA);

    // Verify op_log entries match EXACT_QUOTA
    const opLogCount = db
      .prepare('SELECT COUNT(*) as count FROM op_log WHERE type = ? AND payload_json LIKE ?')
      .get(OP_TYPES.TICKET_ISSUED, `%"eventId":"${eventId}"%`).count;
    expect(opLogCount).toBe(EXACT_QUOTA);
  });
});
