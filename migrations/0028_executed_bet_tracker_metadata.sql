-- Unified betting-ledger metadata for tracker reconciliation.
-- Keeps execution facts immutable while preserving calibration/governance context.
ALTER TABLE executed_bets ADD COLUMN tracker_metadata_json TEXT;

CREATE INDEX IF NOT EXISTS idx_executed_bets_book_date
  ON executed_bets (execution_book, date);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0028_executed_bet_tracker_metadata', datetime('now'));
