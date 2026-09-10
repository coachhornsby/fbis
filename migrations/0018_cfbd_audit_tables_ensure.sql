-- Ensure CFBD audit tables + schema_migrations registration exist.
-- 0017 may have been skipped by an overly aggressive d1_migrations sync.
-- Additive / idempotent only.

CREATE TABLE IF NOT EXISTS cfbd_endpoint_audit (
  id TEXT PRIMARY KEY,
  audited_at TEXT NOT NULL,
  season INTEGER,
  week INTEGER,
  job_run_id TEXT,
  summary_json TEXT,
  endpoints_json TEXT,
  catalog_version TEXT,
  feature_table_json TEXT,
  content_hash TEXT,
  r2_key TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cfbd_endpoint_audit_season
  ON cfbd_endpoint_audit (season, audited_at);

CREATE TABLE IF NOT EXISTS cfb_pregame_feature_vectors (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  season INTEGER,
  week INTEGER,
  kickoff_timestamp TEXT,
  home_team TEXT,
  away_team TEXT,
  feature_as_of_timestamp TEXT NOT NULL,
  feature_cutoff_timestamp TEXT NOT NULL,
  source_version TEXT,
  source_endpoint TEXT,
  collection_timestamp TEXT NOT NULL,
  features_json TEXT,
  decomposition_json TEXT,
  uncertainty_json TEXT,
  model_id TEXT,
  content_hash TEXT,
  job_run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cfb_pregame_feat_game
  ON cfb_pregame_feature_vectors (game_id, feature_cutoff_timestamp);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0017_cfbd_endpoint_audit', datetime('now'));

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0018_cfbd_audit_tables_ensure', datetime('now'));
