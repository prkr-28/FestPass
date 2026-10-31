/**
 * FestPass Database Seed Script
 *
 * Populates initial users and sample events across all node databases:
 * - 1 Admin user (admin@campus.edu)
 * - 2 Booth staff users (booth1@campus.edu, booth2@campus.edu)
 * - 2 Gate staff users (gate1@campus.edu, gate2@campus.edu)
 * - 3 Sample fest events with distributed booth quotas across B1, B2, B3
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { runMigrations } = require('../apps/server/src/db/migrator');
const { SnowflakeGenerator, HLC, OP_TYPES } = require('@festpass/shared');

// Determine potential data directory paths
const targetDirs = [
  path.resolve(__dirname, '..', 'data'),
  path.resolve(__dirname, '..', 'apps', 'server', 'data'),
];

const NODE_IDS = ['B1', 'B2', 'B3', 'G1', 'G2', 'G3'];
const BOOTH_IDS = ['B1', 'B2', 'B3'];

const USERS = [
  {
    id: '1001',
    name: 'FestPass Administrator',
    email: 'admin@campus.edu',
    password: 'AdminPass123!',
    role: 'admin',
  },
  {
    id: '1002',
    name: 'Jordan Lee (Booth 1 Operator)',
    email: 'booth1@campus.edu',
    password: 'BoothPass123!',
    role: 'booth_staff',
  },
  {
    id: '1003',
    name: 'Taylor Swift (Booth 2 Operator)',
    email: 'booth2@campus.edu',
    password: 'BoothPass123!',
    role: 'booth_staff',
  },
  {
    id: '1004',
    name: 'Alex Rivera (Gate 1 Guard)',
    email: 'gate1@campus.edu',
    password: 'GatePass123!',
    role: 'gate_staff',
  },
  {
    id: '1005',
    name: 'Sam Chen (Gate 2 Guard)',
    email: 'gate2@campus.edu',
    password: 'GatePass123!',
    role: 'gate_staff',
  },
];

const EVENTS = [
  {
    id: 'evt_techfest_2026',
    name: 'Annual TechFest 2026',
    venue: 'Campus Main Auditorium',
    starts_at: '2026-11-15T18:00:00.000Z',
    capacity: 300,
    price: 25.0,
    status: 'on_sale',
  },
  {
    id: 'evt_edm_night_2026',
    name: 'Spring EDM Night 2026',
    venue: 'North Quad Arena',
    starts_at: '2026-12-01T20:00:00.000Z',
    capacity: 600,
    price: 30.0,
    status: 'on_sale',
  },
  {
    id: 'evt_hackathon_showcase',
    name: 'Campus Hackathon Showcase',
    venue: 'Engineering Hall B',
    starts_at: '2026-12-10T10:00:00.000Z',
    capacity: 150,
    price: 0.0,
    status: 'draft',
  },
];

async function seed() {
  console.log('====================================================');
  console.log('FestPass Database Seed (Stage 2)');
  console.log('====================================================');

  // Pre-hash passwords
  const salt = bcrypt.genSaltSync(10);
  const usersWithHashes = USERS.map((u) => ({
    ...u,
    password_hash: bcrypt.hashSync(u.password, salt),
  }));

  for (const dataDir of targetDirs) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    console.log(`Seeding node databases in: ${dataDir}`);

    for (let i = 0; i < NODE_IDS.length; i++) {
      const nodeId = NODE_IDS[i];
      const dbPath = path.join(dataDir, `${nodeId}.db`);
      const db = new Database(dbPath);

      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');

      // Run migrations
      runMigrations(db);

      const snowflake = new SnowflakeGenerator({ nodeId: i + 1 });
      const hlc = new HLC({ nodeId });

      db.transaction(() => {
        // Clean operational runtime tables for pristine convergence
        try {
          db.prepare('DELETE FROM checkins').run();
          db.prepare('DELETE FROM tickets').run();
          db.prepare('DELETE FROM conflicts').run();
          db.prepare('DELETE FROM op_log').run();
          db.prepare('DELETE FROM ticket_claims').run();
          db.prepare('DELETE FROM outbox').run();
          db.prepare('DELETE FROM booth_quotas').run();
          db.prepare(`DELETE FROM events WHERE id NOT IN (${EVENTS.map(() => '?').join(',')})`).run(
            ...EVENTS.map((e) => e.id)
          );
        } catch (_err) {
          // In case some tables don't exist yet before migrations
        }

        // 1. Seed Users
        const insertUser = db.prepare(`
          INSERT INTO users (id, name, email, password_hash, role)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            email = excluded.email,
            password_hash = excluded.password_hash,
            role = excluded.role
        `);

        for (const user of usersWithHashes) {
          insertUser.run(user.id, user.name, user.email, user.password_hash, user.role);
        }

        // 2. Seed Events and Quotas
        const insertEvent = db.prepare(`
          INSERT INTO events (id, name, venue, starts_at, capacity, price, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            venue = excluded.venue,
            starts_at = excluded.starts_at,
            capacity = excluded.capacity,
            price = excluded.price,
            status = excluded.status
        `);

        const insertQuota = db.prepare(`
          INSERT INTO booth_quotas (event_id, node_id, quota, sold)
          VALUES (?, ?, ?, 0)
          ON CONFLICT(event_id, node_id) DO UPDATE SET
            quota = excluded.quota
        `);

        const insertOpLog = db.prepare(`
          INSERT INTO op_log (op_id, origin_node, hlc, type, payload_json, applied_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(op_id) DO NOTHING
        `);

        for (const evt of EVENTS) {
          insertEvent.run(
            evt.id,
            evt.name,
            evt.venue,
            evt.starts_at,
            evt.capacity,
            evt.price,
            evt.status
          );

          // Partition quota across B1, B2, B3
          const perBooth = Math.floor(evt.capacity / BOOTH_IDS.length);
          const remainder = evt.capacity % BOOTH_IDS.length;

          const quotas = [];
          BOOTH_IDS.forEach((boothId, idx) => {
            const quota = perBooth + (idx === 0 ? remainder : 0);
            insertQuota.run(evt.id, boothId, quota);
            quotas.push({ event_id: evt.id, node_id: boothId, quota, sold: 0 });
          });

          // Write EVENT_UPSERT op_log entry
          const opId = snowflake.nextId();
          const eventHlc = hlc.send().toString();
          insertOpLog.run(
            opId,
            nodeId,
            eventHlc,
            OP_TYPES.EVENT_UPSERT,
            JSON.stringify({ event: evt, quotas, isUpdate: false })
          );
        }
      })();

      db.close();
      console.log(`  ✓ Node ${nodeId} seeded successfully (${dbPath})`);
    }
  }

  console.log('====================================================');
  console.log('Seed Complete!');
  console.log('Credentials:');
  console.log('  Admin:       admin@campus.edu  / AdminPass123!');
  console.log('  Booth Staff: booth1@campus.edu / BoothPass123!');
  console.log('  Gate Staff:  gate1@campus.edu  / GatePass123!');
  console.log('====================================================');
}

seed().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
