const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const { getDb } = require('../src/db');
const config = require('../src/config');
const peerTransport = require('../src/services/peerTransport');
const gateService = require('../src/services/gateService');
const { applyCheckinRecorded } = require('../src/services/crdtEngine');

describe('Gate Validation, Quorum Consensus & Conflict Resolution (Stage 4)', () => {
  let app;
  const originalNodeRole = config.nodeRole;
  const originalNodeId = config.nodeId;

  const adminToken = jwt.sign(
    { id: 'u_admin', name: 'Admin', email: 'admin@campus.edu', role: 'admin' },
    config.jwtSecret
  );

  const gateToken = jwt.sign(
    { id: 'u_gate', name: 'Gate Staff', email: 'gate@campus.edu', role: 'gate_staff' },
    config.jwtSecret
  );

  const boothToken = jwt.sign(
    { id: 'u_booth', name: 'Booth Staff', email: 'booth@campus.edu', role: 'booth_staff' },
    config.jwtSecret
  );

  let sampleEventId;
  let validTicketToken;
  let validTicketId;

  beforeAll(async () => {
    config.nodeRole = 'both';
    app = createApp();

    // Create an event
    const eventRes = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'FestPass Validation Fest',
        venue: 'Main Gate Plaza',
        startsAt: '2026-11-20T10:00:00.000Z',
        capacity: 500,
        price: 20.0,
        status: 'on_sale',
      });

    sampleEventId = eventRes.body.event.id;

    // Issue a valid ticket
    const ticketRes = await request(app)
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        eventId: sampleEventId,
        holderName: 'Alice Valid',
        holderEmail: 'alice@campus.edu',
        holderPhone: '+15551234567',
      });

    validTicketId = ticketRes.body.ticket.ticketId || ticketRes.body.ticket.id;
    validTicketToken = ticketRes.body.ticket.token;
  });

  afterEach(() => {
    config.nodeRole = 'both';
    config.nodeId = 'B1';
    peerTransport.resetChaos();
  });

  afterAll(() => {
    config.nodeRole = originalNodeRole;
    config.nodeId = originalNodeId;
    peerTransport.resetChaos();
  });

  it('verifies Ed25519 signature and accepts a valid ticket scan', async () => {
    config.nodeRole = 'gate';
    config.nodeId = 'G1';

    // Mock peer gate claims to return granted
    const postSpy = vi.spyOn(peerTransport, 'post').mockResolvedValue({
      data: { granted: true, claimantNodeId: 'G1' },
    });

    const res = await request(app)
      .post('/gate/scan')
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: validTicketToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result).toBe('accepted');
    expect(res.body.ticketId).toBe(validTicketId);
    expect(res.body.mode).toBe('online');
    expect(res.body.latencyMs).toBeGreaterThanOrEqual(0);

    postSpy.mockRestore();
  });

  it('rejects duplicate scan of an already checked-in ticket', async () => {
    config.nodeRole = 'gate';
    config.nodeId = 'G1';

    const res = await request(app)
      .post('/gate/scan')
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: validTicketToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.result).toBe('rejected_duplicate');
    expect(res.body.ticketId).toBe(validTicketId);
    expect(res.body.firstCheckedInAt).toBeDefined();
  });

  it('rejects tampered and forged ticket tokens as rejected_invalid', async () => {
    config.nodeRole = 'gate';

    // 1. Tampered payload
    const tamperedToken = validTicketToken.slice(0, -6) + 'XXXXXX';
    const res1 = await request(app)
      .post('/gate/scan')
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: tamperedToken });

    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(false);
    expect(res1.body.result).toBe('rejected_invalid');

    // 2. Completely fake token string
    const res2 = await request(app)
      .post('/gate/scan')
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: 'INVALID.TOKEN.STRING' });

    expect(res2.status).toBe(200);
    expect(res2.body.success).toBe(false);
    expect(res2.body.result).toBe('rejected_invalid');
  });

  it('rejects scan of a revoked ticket', async () => {
    config.nodeRole = 'both';

    // Issue new ticket
    const ticketRes = await request(app)
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        eventId: sampleEventId,
        holderName: 'Bob Revoked',
        holderEmail: 'bob@campus.edu',
        holderPhone: '+15559876543',
      });

    const revokedTicketId = ticketRes.body.ticket.ticketId || ticketRes.body.ticket.id;
    const revokedToken = ticketRes.body.ticket.token;

    // Revoke ticket
    await request(app)
      .post(`/tickets/${revokedTicketId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Refund requested' });

    // Gate scan
    config.nodeRole = 'gate';
    const res = await request(app)
      .post('/gate/scan')
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: revokedToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.result).toBe('revoked');
    expect(res.body.error).toContain('revoked');
  });

  it('enforces RBAC and Node Role: booth role and unauthorized users are rejected', async () => {
    // 1. Unauthorized request
    const unauthRes = await request(app).post('/gate/scan').send({ token: validTicketToken });
    expect(unauthRes.status).toBe(401);

    // 2. Wrong staff role (booth_staff cannot scan at gates)
    const roleRes = await request(app)
      .post('/gate/scan')
      .set('Authorization', `Bearer ${boothToken}`)
      .send({ token: validTicketToken });
    expect(roleRes.status).toBe(403);

    // 3. Wrong node role (booth node cannot validate gates)
    config.nodeRole = 'booth';
    const nodeRes = await request(app)
      .post('/gate/scan')
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: validTicketToken });
    expect(nodeRes.status).toBe(403);

    config.nodeRole = 'both';
  });

  it('persists ticket claims across restarts and rejects higher HLC claim attempts', () => {
    const db = getDb();
    const testTicket = 'test_ticket_persist_' + Date.now();
    const earlierHlc = '1761820000000:0:G1';
    const laterHlc = '1761820000000:0:G2';

    // Grant to G1
    const grant1 = gateService.grantClaimLocally(testTicket, 'G1', earlierHlc);
    expect(grant1.granted).toBe(true);

    // Persisted in DB:
    const saved = db.prepare('SELECT * FROM ticket_claims WHERE ticket_id = ?').get(testTicket);
    expect(saved.claimant_node_id).toBe('G1');

    // Attempt claim by G2 with later HLC: rejected
    const grant2 = gateService.grantClaimLocally(testTicket, 'G2', laterHlc);
    expect(grant2.granted).toBe(false);
    expect(grant2.reason).toBe('higher_hlc');

    // Attempt claim with earlier HLC: succeeds and updates grant
    const earliestHlc = '1761819999000:0:G3';
    const grant3 = gateService.grantClaimLocally(testTicket, 'G3', earliestHlc);
    expect(grant3.granted).toBe(true);
    expect(grant3.claimantNodeId).toBe('G3');
  });

  it('simulates concurrent double-scan: exactly 1 wins quorum, the other is rejected', async () => {
    config.nodeRole = 'both';

    // Issue a fresh ticket
    const ticketRes = await request(app)
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        eventId: sampleEventId,
        holderName: 'Charlie Concurrent',
        holderEmail: 'charlie@campus.edu',
        holderPhone: '+15555555555',
      });

    const cTicket = ticketRes.body.ticket;
    const cTicketId = cTicket.ticketId || cTicket.id;

    // Simulate G1 and G2 claiming:
    // G1 has earlier HLC, G2 has later HLC
    const hlc1 = '1761820100000:0:G1';
    const hlc2 = '1761820100000:0:G2';

    // G1 claims locally
    const g1Local = gateService.grantClaimLocally(cTicketId, 'G1', hlc1);
    expect(g1Local.granted).toBe(true);

    // G2 claims locally, but G1 asks G2 -> G1 wins because G1 < G2
    const g2Local = gateService.grantClaimLocally(cTicketId, 'G2', hlc2);
    // G2 has higher HLC than G1 already recorded
    expect(g2Local.granted).toBe(false);
  });

  it('handles offline mode and reconciles concurrent offline checkins via deterministic CRDT conflict resolution', () => {
    const db = getDb();
    const testTicketId = 'offline_conflict_ticket_' + Date.now();
    const eventId = sampleEventId;

    // Insert ticket record
    db.prepare(
      `
      INSERT INTO tickets (id, event_id, holder_name, holder_email, holder_phone, issued_by_node, issued_at_hlc, status, token, created_at)
      VALUES (?, ?, 'Offline Attendee', 'off@campus.edu', '123', 'B1', '1000:0:B1', 'valid', 'token', datetime('now'))
    `
    ).run(testTicketId, eventId);

    // Scan at G1 in offline mode at HLC 2000
    const hlcG1 = '1761820200000:0:G1';
    const checkinG1 = {
      checkinId: 'chk_g1_' + Date.now(),
      ticketId: testTicketId,
      gateNodeId: 'G1',
      hlc: hlcG1,
      mode: 'offline',
      result: 'accepted',
    };
    applyCheckinRecorded(db, { op_id: 'op1', origin_node: 'G1', hlc: hlcG1 }, checkinG1);

    // Verify G1 checkin is accepted
    const checkinRow1 = db.prepare('SELECT * FROM checkins WHERE id = ?').get(checkinG1.checkinId);
    expect(checkinRow1.result).toBe('accepted');

    // Scan at G2 in offline mode at earlier HLC 1900
    const hlcG2 = '1761820190000:0:G2';
    const checkinG2 = {
      checkinId: 'chk_g2_' + Date.now(),
      ticketId: testTicketId,
      gateNodeId: 'G2',
      hlc: hlcG2,
      mode: 'offline',
      result: 'accepted',
    };
    applyCheckinRecorded(db, { op_id: 'op2', origin_node: 'G2', hlc: hlcG2 }, checkinG2);

    // Check reconciliation:
    // G2 was earlier -> G2 is WINNER ('accepted')
    // G1 was later -> G1 is LOSER ('rejected_duplicate', resolved = 1)
    const chk1Updated = db.prepare('SELECT * FROM checkins WHERE id = ?').get(checkinG1.checkinId);
    const chk2Updated = db.prepare('SELECT * FROM checkins WHERE id = ?').get(checkinG2.checkinId);

    expect(chk2Updated.result).toBe('accepted');
    expect(chk1Updated.result).toBe('rejected_duplicate');
    expect(chk1Updated.resolved).toBe(1);

    // Verify conflict logged in conflicts table
    const conflict = db.prepare('SELECT * FROM conflicts WHERE ticket_id = ?').get(testTicketId);
    expect(conflict).toBeDefined();
    expect(conflict.winner_checkin_id).toBe(checkinG2.checkinId);
    expect(conflict.loser_checkin_id).toBe(checkinG1.checkinId);

    // Verify ticket has fraud_alert flag set
    const ticketRow = db.prepare('SELECT * FROM tickets WHERE id = ?').get(testTicketId);
    expect(ticketRow.fraud_alert).toBe(1);
    expect(ticketRow.status).toBe('used');
  });

  it('POST /gate/scan-offline-batch replays multiple scans ordered by HLC and identifies conflicts', async () => {
    config.nodeRole = 'both';

    // Issue a ticket to scan in batch
    const tRes = await request(app)
      .post('/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        eventId: sampleEventId,
        holderName: 'Batch User',
        holderEmail: 'batch@campus.edu',
        holderPhone: '+15554443322',
      });

    const bToken = tRes.body.ticket.token;

    config.nodeRole = 'gate';
    const res = await request(app)
      .post('/gate/scan-offline-batch')
      .set('Authorization', `Bearer ${gateToken}`)
      .send({
        scans: [
          {
            token: bToken,
            gateNodeId: 'G1',
            hlc: '1761820500000:0:G1',
            scannedAt: '2026-10-31T10:00:00.000Z',
          },
          {
            token: bToken,
            gateNodeId: 'G2',
            hlc: '1761820500100:0:G2',
            scannedAt: '2026-10-31T10:00:00.100Z',
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.processed).toBe(2);
    expect(res.body.accepted).toBe(1);
    expect(res.body.conflicts.length).toBe(1);
  });

  it('GET /gate/checkins returns history with pagination and filters', async () => {
    config.nodeRole = 'gate';
    const res = await request(app)
      .get('/gate/checkins?limit=10&page=1')
      .set('Authorization', `Bearer ${gateToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.checkins)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
  });

  it('GET /gate/stats returns entrance statistics and duplicate counts', async () => {
    config.nodeRole = 'gate';
    const res = await request(app).get('/gate/stats').set('Authorization', `Bearer ${gateToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.enteredCount).toBeGreaterThanOrEqual(1);
    expect(res.body.duplicateBlocked).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.perEvent)).toBe(true);
  });

  it('GET /tickets/:id/status returns ticket status, fraudAlert flag, and checkins list', async () => {
    const res = await request(app).get(`/tickets/${validTicketId}/status`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.ticketId).toBe(validTicketId);
    expect(res.body.status).toBe('used');
    expect(typeof res.body.fraudAlert).toBe('boolean');
    expect(Array.isArray(res.body.checkins)).toBe(true);
  });
});
