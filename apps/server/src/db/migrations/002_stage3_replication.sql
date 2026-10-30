-- Migration 002: Stage 3 Replication & Outbox Schema
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  peer_node_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(peer_node_id, op_id)
);
CREATE INDEX IF NOT EXISTS idx_outbox_peer ON outbox(peer_node_id);

-- Recreate peers table to ensure status supports ('healthy', 'alive', 'suspect', 'dead')
CREATE TABLE IF NOT EXISTS peers_new (
  node_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  role TEXT NOT NULL,
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'healthy' CHECK(status IN ('healthy', 'alive', 'suspect', 'dead'))
);

INSERT OR IGNORE INTO peers_new (node_id, url, role, last_seen, status)
  SELECT node_id, url, role, last_seen, status FROM peers;

DROP TABLE IF EXISTS peers;
ALTER TABLE peers_new RENAME TO peers;
