-- FestPass Migration 001: Initial Schema
-- Tables for distributed campus ticketing and entry validation

-- 1. Users table (Admin, Booth Staff, Gate Staff)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'booth_staff', 'gate_staff')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Events table
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  venue TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity >= 0),
  price REAL NOT NULL DEFAULT 0.0 CHECK(price >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft', 'published', 'active', 'completed', 'cancelled', 'on_sale', 'closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3. Booth quotas table (for quota-based oversell prevention)
CREATE TABLE IF NOT EXISTS booth_quotas (
  event_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  quota INTEGER NOT NULL DEFAULT 0 CHECK(quota >= 0),
  sold INTEGER NOT NULL DEFAULT 0 CHECK(sold >= 0),
  PRIMARY KEY (event_id, node_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- 4. Tickets table
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  holder_email TEXT NOT NULL,
  holder_phone TEXT NOT NULL,
  issued_by_node TEXT NOT NULL,
  issued_at_hlc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'valid' CHECK(status IN ('valid', 'used', 'revoked')),
  token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id)
);
CREATE INDEX IF NOT EXISTS idx_tickets_event_id ON tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_holder_email ON tickets(holder_email);
CREATE INDEX IF NOT EXISTS idx_tickets_holder_phone ON tickets(holder_phone);

-- 5. Checkins table
CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  gate_node_id TEXT NOT NULL,
  hlc TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('online', 'offline')),
  result TEXT NOT NULL CHECK(result IN ('accepted', 'rejected_duplicate', 'rejected_invalid')),
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id)
);
CREATE INDEX IF NOT EXISTS idx_checkins_ticket_id ON checkins(ticket_id);
CREATE INDEX IF NOT EXISTS idx_checkins_hlc ON checkins(hlc);

-- 6. Operation Log (for state machine replication and anti-entropy sync)
CREATE TABLE IF NOT EXISTS op_log (
  op_id TEXT PRIMARY KEY,
  origin_node TEXT NOT NULL,
  hlc TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_op_log_hlc ON op_log(hlc);

-- 7. Peer nodes table (for gossip protocol and failure detection)
CREATE TABLE IF NOT EXISTS peers (
  node_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  role TEXT NOT NULL,
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'healthy' CHECK(status IN ('healthy', 'suspect', 'dead'))
);

-- 8. Conflicts table (for logging offline concurrent check-in conflicts)
CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  winner_checkin_id TEXT NOT NULL,
  loser_checkin_id TEXT NOT NULL,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  details_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conflicts_ticket_id ON conflicts(ticket_id);

-- 9. Meta key-value store (schema versions, node local state, etc.)
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
