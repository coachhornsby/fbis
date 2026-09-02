-- Probability integrity: new columns on future tickets only.
-- Do not backfill or overwrite historical strategy_tickets probability fields.

ALTER TABLE strategy_tickets ADD COLUMN model_probability REAL;
ALTER TABLE strategy_tickets ADD COLUMN probability_schema_version TEXT;
ALTER TABLE strategy_tickets ADD COLUMN expected_roi_formula_version TEXT;
ALTER TABLE strategy_tickets ADD COLUMN validation_timestamp TEXT;
ALTER TABLE strategy_tickets ADD COLUMN validation_result TEXT;
ALTER TABLE strategy_tickets ADD COLUMN validation_failure_reason TEXT;
ALTER TABLE strategy_tickets ADD COLUMN source_projection_id TEXT;
ALTER TABLE strategy_tickets ADD COLUMN market_snapshot_id TEXT;
ALTER TABLE strategy_tickets ADD COLUMN freeze_id TEXT;
ALTER TABLE strategy_tickets ADD COLUMN qualification_rule_version TEXT;

CREATE TABLE IF NOT EXISTS strategy_ticket_probability_corrections (
  id TEXT PRIMARY KEY,
  original_ticket_id TEXT NOT NULL,
  reconstructed_model_probability REAL,
  reconstruction_source TEXT,
  reconstruction_status TEXT NOT NULL,
  reconstruction_reason TEXT,
  expected_roi_recomputed REAL,
  freeze_id TEXT,
  source_projection_id TEXT,
  market_snapshot_id TEXT,
  inputs_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prob_corrections_ticket
  ON strategy_ticket_probability_corrections (original_ticket_id, created_at);

CREATE TABLE IF NOT EXISTS strategy_qualification_attempts (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  sport TEXT,
  date TEXT,
  market TEXT,
  side TEXT,
  model_probability REAL,
  expected_roi REAL,
  validation_result TEXT NOT NULL,
  validation_failure_reason TEXT,
  freeze_id TEXT,
  source_projection_id TEXT,
  market_snapshot_id TEXT,
  canary INTEGER,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0013_probability_integrity', datetime('now'));
