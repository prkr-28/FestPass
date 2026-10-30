const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createApp } = require('../src/app');
const { getDb } = require('../src/db');
const config = require('../src/config');

describe('Authentication & Role Middleware', () => {
  const app = createApp();

  beforeAll(() => {
    const db = getDb();
    const salt = bcrypt.genSaltSync(8);

    // Ensure test users exist
    const insertUser = db.prepare(`
      INSERT INTO users (id, name, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        password_hash = excluded.password_hash,
        role = excluded.role
    `);

    insertUser.run(
      'u_admin',
      'Admin User',
      'admin_test@campus.edu',
      bcrypt.hashSync('AdminPass123!', salt),
      'admin'
    );
    insertUser.run(
      'u_booth',
      'Booth Staff',
      'booth_test@campus.edu',
      bcrypt.hashSync('BoothPass123!', salt),
      'booth_staff'
    );
    insertUser.run(
      'u_gate',
      'Gate Staff',
      'gate_test@campus.edu',
      bcrypt.hashSync('GatePass123!', salt),
      'gate_staff'
    );
  });

  it('POST /auth/login succeeds with correct credentials and returns JWT token', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin_test@campus.edu', password: 'AdminPass123!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toEqual({
      id: 'u_admin',
      name: 'Admin User',
      email: 'admin_test@campus.edu',
      role: 'admin',
    });

    // Verify token structure
    const decoded = jwt.verify(res.body.token, config.jwtSecret);
    expect(decoded.id).toBe('u_admin');
    expect(decoded.role).toBe('admin');
  });

  it('POST /api/auth/login works identically under /api prefix', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'booth_test@campus.edu', password: 'BoothPass123!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.role).toBe('booth_staff');
  });

  it('POST /auth/login fails with 401 when password is wrong', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin_test@campus.edu', password: 'WrongPassword' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /auth/login fails with 401 when email does not exist', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@campus.edu', password: 'Password123!' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /auth/me returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /auth/me succeeds with valid Bearer token', async () => {
    const token = jwt.sign(
      { id: 'u_admin', name: 'Admin User', email: 'admin_test@campus.edu', role: 'admin' },
      config.jwtSecret
    );

    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe('admin_test@campus.edu');
    expect(res.body.user.role).toBe('admin');
  });

  it('verifies token cross-node (token signed for node B1 is valid on node B2 using shared secret)', () => {
    // Simulate B1 issuing token
    const tokenFromB1 = jwt.sign(
      { id: 'u_booth', name: 'Booth Staff', email: 'booth_test@campus.edu', role: 'booth_staff' },
      config.jwtSecret
    );

    // Node B2 verifies token using same shared secret
    const verifiedOnB2 = jwt.verify(tokenFromB1, config.jwtSecret);
    expect(verifiedOnB2.id).toBe('u_booth');
    expect(verifiedOnB2.role).toBe('booth_staff');
  });

  it('enforces RBAC: non-admin is forbidden from admin routes', async () => {
    const boothToken = jwt.sign(
      { id: 'u_booth', name: 'Booth Staff', email: 'booth_test@campus.edu', role: 'booth_staff' },
      config.jwtSecret
    );

    // Attempting to create an event with booth_staff role
    const res = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${boothToken}`)
      .send({
        name: 'Unauthorized Event',
        venue: 'Room 101',
        startsAt: '2026-11-20T10:00:00.000Z',
        capacity: 100,
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
