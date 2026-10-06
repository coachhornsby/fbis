-- NBA official observation ingestion health.
CREATE TABLE IF NOT EXISTS nba_observation_health (
  path_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  last_attempted_fetch TEXT NOT NULL,
  last_successful_fetch TEXT,
  source_row_count INTEGER NOT NULL DEFAULT 0,
  normalized_row_count INTEGER NOT NULL DEFAULT 0,
  persisted_row_count INTEGER NOT NULL DEFAULT 0,
  rejected_row_count INTEGER NOT NULL DEFAULT 0,
  zero_row_reason TEXT,
  source_freshness TEXT,
  error_state TEXT,
  detail_json TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_observation_health_updated ON nba_observation_health(updated_at DESC);
INSERT OR IGNORE INTO schema_migrations(id,applied_at) VALUES('0068_nba_observation_health',datetime('now'));
