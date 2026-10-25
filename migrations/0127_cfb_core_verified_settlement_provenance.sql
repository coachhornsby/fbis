-- Preserve explicit score provenance for prospective CORE research settlement.
-- This is evidence metadata only; all records remain research-only.
ALTER TABLE cfb_core_shadow_predictions ADD COLUMN settlement_source TEXT;
ALTER TABLE cfb_core_shadow_predictions ADD COLUMN settlement_source_url TEXT;
ALTER TABLE cfb_core_shadow_predictions ADD COLUMN settlement_orientation TEXT;
ALTER TABLE cfb_core_shadow_predictions ADD COLUMN settlement_verified_at TEXT;
ALTER TABLE cfb_tier3_training_snapshots ADD COLUMN source_url TEXT;

CREATE TABLE IF NOT EXISTS cfb_core_shadow_settlement_attempts (
  game_id TEXT PRIMARY KEY,
  last_attempt_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  source_url TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES ('0127_cfb_core_verified_settlement_provenance',datetime('now'));
