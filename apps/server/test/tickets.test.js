const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const { getDb } = require('../src/db');
const config = require('../src/config');
const { verifyTicket, OP_TYPES } = require('@festpass/shared');
const tokenService = require('../src/services/tokenService');

describe('Ticket Issuance, Lookup, Revocation & Stats', () => {
  const app = createApp();

  const adminToken = jwt.sign(
    { id: 'u_admin', name: 'Admin', email: 'admin@campus.edu', role: 'admin' },
    config.jwtSecret
  );

  const boothToken = jwt.sign(
    { id: 'u_booth', name: 'Booth Staff', email: 'booth@campus.edu', role: 'booth_staff' },
    config.jwtSecret
  );

  let testEventId;

  beforeAll(async () => {
    // Create an event with ample quota on B1
    const res = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Ticket Sales Test Fest',
        venue: 'Grand Quad',
        startsAt: '2026-12-15T18:00:00.000Z',
        capacity: 150,
        price: 25.0,
        status: 'on_sale',
      });

    testEventId = res.body.event.id;
  });

  it('POST /tickets issues a valid ticket, verifies token with Ed25519 public key, and logs TICKET_ISSUED', async () => {
    const res = await request(app)
      .post('/tickets')
      .set('Authorization', `Bearer ${boothToken}`)
      .send({
        eventId: testEventId,
        holderName: 'Alice Johnson',
        holderEmail: 'alice.j@campus.edu',
        holderPhone: '+15551234567',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const { ticket } = res.body;

    expect(ticket.ticketId).toBeDefined();
    expect(ticket.eventId).toBe(testEventId);
    expect(ticket.holderName).toBe('Alice Johnson');
    expect(ticket.holderEmail).toBe('alice.j@campus.edu');
    expect(ticket.status).toBe('valid');
    expect(ticket.issuedByNode).toBe(config.nodeId);
    expect(ticket.issuedAtHlc).toBeDefined();
    expect(ticket.token).toMatch(/^FP1\.\d+\..+/);

    // Verify token validity using shared helper with public key
    const publicKey = tokenService.getPublicKey();
    const verified = verifyTicket({ token: ticket.token, publicKey });
    expect(verified.valid).toBe(true);
    expect(verified.ticketId).toBe(ticket.ticketId);
    expect(verified.eventId).toBe(testEventId);

    // Verify row in tickets table
    const db = getDb();
    const dbTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.ticketId);
    expect(dbTicket).toBeDefined();
    expect(dbTicket.holder_email).toBe('alice.j@campus.edu');

    // Verify op_log entry
    const op = db
      .prepare('SELECT * FROM op_log WHERE type = ? AND payload_json LIKE ?')
      .get(OP_TYPES.TICKET_ISSUED, `%"ticketId":"${ticket.ticketId}"%`);
    expect(op).toBeDefined();
    expect(op.origin_node).toBe(config.nodeId);
  });

  it('POST /api/tickets/issue works identically under contract path', async () => {
    const res = await request(app)
      .post('/api/tickets/issue')
      .set('Authorization', `Bearer ${boothToken}`)
      .send({
        eventId: testEventId,
        holderName: 'Bob Builder',
        holderEmail: 'bob.b@campus.edu',
        holderPhone: '+15557654321',
      });

    expect(res.status).toBe(201);
    expect(res.body.ticket.holderName).toBe('Bob Builder');
  });

  it('supports Idempotency-Key header to prevent duplicate ticket generation and overselling', async () => {
    const idempotencyKey = `idem-${Date.now()}-${Math.random()}`;
    const testEmail = `charlie_${Date.now()}@campus.edu`;
    const payload = {
      eventId: testEventId,
      holderName: 'Charlie Brown',
      holderEmail: testEmail,
      holderPhone: '+15559876543',
    };

    // First request
    const firstRes = await request(app)
      .post('/tickets')
      .set('Authorization', `Bearer ${boothToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(firstRes.status).toBe(201);
    const firstTicketId = firstRes.body.ticket.ticketId;

    const db = getDb();
    const soldAfterFirst = db
      .prepare('SELECT sold FROM booth_quotas WHERE event_id = ? AND node_id = ?')
      .get(testEventId, config.nodeId).sold;

    // Retry request with same Idempotency-Key
    const secondRes = await request(app)
      .post('/tickets')
      .set('Authorization', `Bearer ${boothToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(secondRes.status).toBe(201);
    expect(secondRes.body.ticket.ticketId).toBe(firstTicketId);

    const soldAfterSecond = db
      .prepare('SELECT sold FROM booth_quotas WHERE event_id = ? AND node_id = ?')
      .get(testEventId, config.nodeId).sold;

    // Quota was NOT decremented twice
    expect(soldAfterSecond).toBe(soldAfterFirst);

    // Only one ticket exists in database
    const ticketsCount = db
      .prepare('SELECT COUNT(*) as count FROM tickets WHERE holder_email = ?')
      .get(testEmail).count;
    expect(ticketsCount).toBe(1);
  });

  it('bulk issues up to 20 tickets atomically and rejects requests over 20', async () => {
    const groupTickets = Array.from({ length: 5 }, (_, i) => ({
      holderName: `Group Member ${i + 1}`,
      holderEmail: `member${i + 1}_${Date.now()}@campus.edu`,
      holderPhone: `+1555000000${i}`,
    }));

    const res = await request(app)
      .post('/tickets/bulk')
      .set('Authorization', `Bearer ${boothToken}`)
      .send({
        eventId: testEventId,
        tickets: groupTickets,
      });

    expect(res.status).toBe(201);
    expect(res.body.count).toBe(5);
    expect(res.body.tickets.length).toBe(5);

    // Request with > 20 tickets rejected
    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      holderName: `Excess Member ${i}`,
      holderEmail: `excess${i}@campus.edu`,
      holderPhone: `+1555999999${i}`,
    }));

    const rejectRes = await request(app)
      .post('/tickets/bulk')
      .set('Authorization', `Bearer ${boothToken}`)
      .send({
        eventId: testEventId,
        tickets: tooMany,
      });

    expect(rejectRes.status).toBe(400);
  });

  it('GET /tickets/:id returns the issued ticket details', async () => {
    const issued = await request(app)
      .post('/tickets')
      .set('Authorization', `Bearer ${boothToken}`)
      .send({
        eventId: testEventId,
        holderName: 'Diana Prince',
        holderEmail: 'diana@campus.edu',
        holderPhone: '+15553334444',
      });

    const ticketId = issued.body.ticket.ticketId;
    const res = await request(app).get(`/tickets/${ticketId}`);

    expect(res.status).toBe(200);
    expect(res.body.ticket.ticketId).toBe(ticketId);
    expect(res.body.ticket.holderName).toBe('Diana Prince');
  });

  it('GET /tickets queries by email and phone', async () => {
    const res = await request(app)
      .get('/tickets')
      .set('Authorization', `Bearer ${boothToken}`)
      .query({ email: 'diana@campus.edu' });

    expect(res.status).toBe(200);
    expect(res.body.tickets.length).toBeGreaterThanOrEqual(1);
    expect(res.body.tickets[0].holderName).toBe('Diana Prince');
  });

  it('POST /tickets/:id/revoke revokes ticket and logs TICKET_REVOKED in op_log', async () => {
    const issued = await request(app)
      .post('/tickets')
      .set('Authorization', `Bearer ${boothToken}`)
      .send({
        eventId: testEventId,
        holderName: 'Eve Refund',
        holderEmail: 'eve@campus.edu',
        holderPhone: '+15557778888',
      });

    const ticketId = issued.body.ticket.ticketId;

    const revokeRes = await request(app)
      .post(`/tickets/${ticketId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Customer requested full refund' });

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.success).toBe(true);
    expect(revokeRes.body.ticket.status).toBe('revoked');

    // Confirm in DB
    const db = getDb();
    const row = db.prepare('SELECT status FROM tickets WHERE id = ?').get(ticketId);
    expect(row.status).toBe('revoked');

    // Confirm op_log row
    const op = db
      .prepare('SELECT * FROM op_log WHERE type = ? AND payload_json LIKE ?')
      .get(OP_TYPES.TICKET_REVOKED, `%"ticketId":"${ticketId}"%`);
    expect(op).toBeDefined();
  });

  it('GET /stats/sales returns sales and revenue statistics', async () => {
    const res = await request(app).get('/stats/sales').query({ eventId: testEventId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stats.totalSold).toBeGreaterThan(0);
    expect(res.body.stats.totalRevenue).toBeGreaterThan(0);
    expect(Array.isArray(res.body.stats.byEvent)).toBe(true);
    expect(Array.isArray(res.body.stats.byBooth)).toBe(true);
  });

  it('gate node cannot issue tickets (returns 403 FORBIDDEN)', async () => {
    // Temporarily set nodeRole to 'gate'
    const originalRole = config.nodeRole;
    config.nodeRole = 'gate';

    try {
      const res = await request(app)
        .post('/tickets')
        .set('Authorization', `Bearer ${boothToken}`)
        .send({
          eventId: testEventId,
          holderName: 'Gate Test',
          holderEmail: 'gate@campus.edu',
          holderPhone: '+15559990000',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    } finally {
      config.nodeRole = originalRole;
    }
  });
});
