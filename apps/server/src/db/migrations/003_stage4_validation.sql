-- FestPass Migration 003: Stage 4 Gate Validation & Quorum Claims
-- Adds ticket_claims table for gate quorum consensus and fraud_alert flag on tickets

-- 1. Persisted ticket claim grants for Gate Quorum Consensus
CREATE TABLE IF NOT EXISTS ticket_claims (
  ticket_id TEXT PRIMARY KEY,
  claimant_node_id TEXT NOT NULL,
  hlc TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ticket_claims_ticket ON ticket_claims(ticket_id);

-- 2. Add fraud_alert flag to tickets (1 = concurrent checkin conflict detected)
ALTER TABLE tickets ADD COLUMN fraud_alert INTEGER NOT NULL DEFAULT 0;

-- 3. Composite index for fast checkin lookups by ticket and result
CREATE INDEX IF NOT EXISTS idx_checkins_ticket_result ON checkins(ticket_id, result);
