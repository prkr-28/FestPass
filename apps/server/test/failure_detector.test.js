/**
 * Unit & Integration Tests: Failure Detector & Membership (Stage 3)
 */

const Database = require('better-sqlite3');
const { PEER_STATUS } = require('@festpass/shared');
const { FailureDetector } = require('../src/services/failureDetector');
const { runMigrations } = require('../src/db/migrator');

describe('Membership & Failure Detector', () => {
  let db;
  let detector;

  beforeEach(() => {
    // Isolated in-memory database with full migrations
    db = new Database(':memory:');
    runMigrations(db);

    detector = new FailureDetector({
      db,
      heartbeatIntervalMs: 50,
      suspectTimeoutMs: 150,
      deadTimeoutMs: 300,
    });
  });

  afterEach(() => {
    detector.stop();
    if (db) db.close();
  });

  it('records a peer as ALIVE and persists to peers table', () => {
    // Populate peer in DB
    db.prepare(
      `
      INSERT INTO peers (node_id, url, role, last_seen, status)
      VALUES ('B2', 'http://localhost:4002', 'booth', datetime('now'), 'alive')
    `
    ).run();

    detector.lastSeenMap.set('B2', Date.now());

    const peer = db.prepare('SELECT * FROM peers WHERE node_id = ?').get('B2');
    expect(peer.status).toBe(PEER_STATUS.ALIVE);
  });

  it('transitions ALIVE -> SUSPECT -> DEAD when heartbeats cease', () => {
    const now = Date.now();
    db.prepare(
      `
      INSERT INTO peers (node_id, url, role, last_seen, status)
      VALUES ('B2', 'http://localhost:4002', 'booth', datetime('now'), 'alive')
    `
    ).run();

    // 1. Initial state: alive
    detector.lastSeenMap.set('B2', now);
    detector.evaluateStates();
    let row = db.prepare('SELECT status FROM peers WHERE node_id = ?').get('B2');
    expect(row.status).toBe(PEER_STATUS.ALIVE);

    // 2. Simulate suspect timeout (elapsed = 200ms > suspectTimeoutMs = 150ms)
    detector.lastSeenMap.set('B2', now - 200);
    detector.evaluateStates();
    row = db.prepare('SELECT status FROM peers WHERE node_id = ?').get('B2');
    expect(row.status).toBe(PEER_STATUS.SUSPECT);

    // 3. Simulate dead timeout (elapsed = 400ms > deadTimeoutMs = 300ms)
    detector.lastSeenMap.set('B2', now - 400);
    detector.evaluateStates();
    row = db.prepare('SELECT status FROM peers WHERE node_id = ?').get('B2');
    expect(row.status).toBe(PEER_STATUS.DEAD);
  });

  it('automatically recovers from DEAD to ALIVE when peer returns', () => {
    db.prepare(
      `
      INSERT INTO peers (node_id, url, role, last_seen, status)
      VALUES ('B2', 'http://localhost:4002', 'booth', datetime('now'), 'dead')
    `
    ).run();

    let recovered = false;
    detector.onStatusChange((nodeId, oldStatus, newStatus) => {
      if (nodeId === 'B2' && oldStatus === 'dead' && newStatus === 'alive') {
        recovered = true;
      }
    });

    // Peer returns and sends gossip or message
    detector.recordPeerAlive('B2', 'booth', 'http://localhost:4002');

    const row = db.prepare('SELECT status FROM peers WHERE node_id = ?').get('B2');
    expect(row.status).toBe(PEER_STATUS.ALIVE);
    expect(recovered).toBe(true);
  });

  it('merges remote peer states when receiving gossip', async () => {
    db.prepare(
      `
      INSERT INTO peers (node_id, url, role, last_seen, status)
      VALUES ('B2', 'http://localhost:4002', 'booth', datetime('now'), 'alive')
    `
    ).run();

    const gossipPayload = {
      originNodeId: 'B2',
      role: 'booth',
      hlc: '1793370000000:0:B2',
      peers: [
        {
          nodeId: 'G1',
          url: 'http://localhost:4004',
          role: 'gate',
          lastSeen: Date.now() - 50,
          status: 'alive',
        },
      ],
    };

    await detector.handleGossip(gossipPayload);

    // B2 should be alive
    const b2 = db.prepare('SELECT status FROM peers WHERE node_id = ?').get('B2');
    expect(b2.status).toBe(PEER_STATUS.ALIVE);

    // G1 should have been merged into the local peers table
    const g1 = db.prepare('SELECT * FROM peers WHERE node_id = ?').get('G1');
    expect(g1).toBeDefined();
    expect(g1.node_id).toBe('G1');
    expect(g1.role).toBe('gate');
  });
});
