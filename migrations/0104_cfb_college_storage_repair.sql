-- 0104: restore canonical college storage tables absent from deployed D1.
-- Shapes match schema.sql. No authority or existing data is modified.
CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL, endpoint TEXT NOT NULL, month TEXT NOT NULL,
  captured_at TEXT NOT NULL, cache_hit INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER, records_returned INTEGER, quota_cost INTEGER,
  ok INTEGER, reason TEXT, query_keys TEXT, elapsed_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_usage_month_source ON api_usage(month,source);

CREATE TABLE IF NOT EXISTS source_observations (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, sport TEXT NOT NULL,
  endpoint TEXT NOT NULL, season INTEGER, partition_key TEXT,
  observed_at TEXT NOT NULL, retrieved_at TEXT NOT NULL,
  schema_version TEXT, record_count INTEGER, content_hash TEXT,
  r2_key TEXT, status TEXT, job_run_id TEXT, meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_source_obs_sport_partition
  ON source_observations(sport,partition_key,source);

CREATE TABLE IF NOT EXISTS team_feature_snapshots (
  id TEXT PRIMARY KEY, sport TEXT NOT NULL, team_id TEXT NOT NULL,
  season INTEGER, as_of TEXT NOT NULL, feature_version TEXT NOT NULL,
  features_json TEXT, missingness_json TEXT, content_hash TEXT,
  job_run_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_features_sport_season
  ON team_feature_snapshots(sport,season,team_id,as_of);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES ('0104_cfb_college_storage_repair',datetime('now'));
