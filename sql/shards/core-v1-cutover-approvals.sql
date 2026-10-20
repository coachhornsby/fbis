-- Approved sport cutover receipts (CORE_DB).
-- A non-empty SPORT_CUTOVER_RECEIPT_* env var is insufficient alone:
-- product sport IO requires a matching APPROVED row here.

CREATE TABLE IF NOT EXISTS fbis_sport_cutover_approvals (
  receipt_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  approved_at TEXT,
  approved_by TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (receipt_id, sport)
);

CREATE INDEX IF NOT EXISTS idx_sport_cutover_approvals_sport_status
  ON fbis_sport_cutover_approvals(sport, status);

INSERT OR REPLACE INTO fbis_topology_migrations(migration_id, applied_at, notes)
VALUES (
  'core-v1-cutover-approvals',
  datetime('now'),
  'Cutover receipts must match APPROVED CORE rows before sport authority'
);
