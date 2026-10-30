const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const { getDb } = require('../src/db');
const config = require('../src/config');
const { OP_TYPES } = require('@festpass/shared');

describe('Events Management & Quota Partitioning', () => {
  const app = createApp();

  const adminToken = jwt.sign(
    { id: 'u_admin', name: 'Admin', email: 'admin@campus.edu', role: 'admin' },
    config.jwtSecret
  );

  const boothToken = jwt.sign(
    { id: 'u_booth', name: 'Booth Staff', email: 'booth@campus.edu', role: 'booth_staff' },
    config.jwtSecret
  );

  it('POST /events partitions capacity into booth_quotas and records EVENT_UPSERT in op_log', async () => {
    const res = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Spring Hackathon 2026',
        venue: 'Innovation Hub',
        startsAt: '2026-11-20T09:00:00.000Z',
        capacity: 300,
        price: 15.0,
        status: 'on_sale',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.event.id).toBeDefined();
    expect(res.body.event.name).toBe('Spring Hackathon 2026');

    const eventId = res.body.event.id;
    const db = getDb();

    // Check booth_quotas partitioned 300 / 3 = 100 each
    const quotas = db
      .prepare('SELECT * FROM booth_quotas WHERE event_id = ? ORDER BY node_id ASC')
      .all(eventId);
    expect(quotas.length).toBe(3);
    expect(quotas.find((q) => q.node_id === 'B1').quota).toBe(100);
    expect(quotas.find((q) => q.node_id === 'B2').quota).toBe(100);
    expect(quotas.find((q) => q.node_id === 'B3').quota).toBe(100);

    // Check op_log entry with HLC timestamp
    const op = db
      .prepare(
        'SELECT * FROM op_log WHERE type = ? AND payload_json LIKE ? ORDER BY applied_at DESC LIMIT 1'
      )
      .get(OP_TYPES.EVENT_UPSERT, `%${eventId}%`);

    expect(op).toBeDefined();
    expect(op.origin_node).toBe(config.nodeId);
    expect(op.hlc).toMatch(/^\d+:\d+:\w+$/);
    const payload = JSON.parse(op.payload_json);
    expect(payload.event.id).toBe(eventId);
  });

  it('partitions capacity with remainder given to the first booth', async () => {
    const res = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Remainder Test Concert',
        venue: 'Amphitheater',
        startsAt: '2026-11-25T19:00:00.000Z',
        capacity: 100, // 100 / 3 = 33 remainder 1 -> B1: 34, B2: 33, B3: 33
        price: 20.0,
      });

    expect(res.status).toBe(201);
    const eventId = res.body.event.id;
    const db = getDb();
    const quotas = db.prepare('SELECT * FROM booth_quotas WHERE event_id = ?').all(eventId);

    const b1 = quotas.find((q) => q.node_id === 'B1').quota;
    const b2 = quotas.find((q) => q.node_id === 'B2').quota;
    const b3 = quotas.find((q) => q.node_id === 'B3').quota;

    expect(b1).toBe(34);
    expect(b2).toBe(33);
    expect(b3).toBe(33);
    expect(b1 + b2 + b3).toBe(100);
  });

  it('GET /events supports search and pagination', async () => {
    const res = await request(app)
      .get('/events')
      .query({ search: 'Hackathon', page: 1, limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.events.some((e) => e.name.includes('Hackathon'))).toBe(true);
  });

  it('GET /events/:id returns event details with booth quotas', async () => {
    // Create an event to query
    const created = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Lookup Event',
        venue: 'Hall A',
        startsAt: '2026-12-05T14:00:00.000Z',
        capacity: 60,
      });

    const eventId = created.body.event.id;
    const res = await request(app).get(`/events/${eventId}`);

    expect(res.status).toBe(200);
    expect(res.body.event.id).toBe(eventId);
    expect(res.body.event.quotas).toBeDefined();
    expect(res.body.event.quotas.length).toBe(3);
  });

  it('PUT /events/:id updates event details and writes EVENT_UPSERT to op_log', async () => {
    const created = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Original Event Name',
        venue: 'Original Venue',
        startsAt: '2026-12-01T12:00:00.000Z',
        capacity: 90,
      });

    const eventId = created.body.event.id;

    const res = await request(app)
      .put(`/events/${eventId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Updated Event Name',
        venue: 'Updated Venue',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.event.name).toBe('Updated Event Name');
    expect(res.body.event.venue).toBe('Updated Venue');

    const db = getDb();
    const ops = db
      .prepare(
        'SELECT * FROM op_log WHERE type = ? AND payload_json LIKE ? ORDER BY applied_at DESC'
      )
      .all(OP_TYPES.EVENT_UPSERT, `%${eventId}%`);

    expect(ops.length).toBeGreaterThanOrEqual(2); // Create + update
  });

  it('rejects unauthorized users from mutating events', async () => {
    const res = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${boothToken}`)
      .send({
        name: 'Forbidden Event',
        venue: 'Nowhere',
        startsAt: '2026-12-01T12:00:00.000Z',
        capacity: 100,
      });

    expect(res.status).toBe(403);
  });
});
