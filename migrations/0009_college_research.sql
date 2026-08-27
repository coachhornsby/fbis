-- College research store: compact operational tables. Immutable inserts.
-- D1 id b50c724c-903b-4241-8ce1-48d931e7a44c. Do not store raw PBP here.

CREATE TABLE IF NOT EXISTS source_observations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  sport TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  season INTEGER,
  partition_key TEXT,
  observed_at TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  schema_version TEXT,
  record_count INTEGER,
  content_hash TEXT,
  r2_key TEXT,
  status TEXT,
  job_run_id TEXT,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_source_obs_src ON source_observations (source, sport, endpoint, season);

CREATE TABLE IF NOT EXISTS team_feature_snapshots (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  team_id TEXT NOT NULL,
  season INTEGER,
  as_of TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  features_json TEXT,
  missingness_json TEXT,
  content_hash TEXT,
  job_run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_team_feat ON team_feature_snapshots (sport, team_id, as_of);

CREATE TABLE IF NOT EXISTS game_feature_snapshots (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  game_id TEXT NOT NULL,
  home_team_id TEXT,
  away_team_id TEXT,
  scheduled_start TEXT,
  feature_cutoff TEXT NOT NULL,
  source_obs_json TEXT,
  source_versions_json TEXT,
  feature_schema_version TEXT,
  model_version TEXT,
  neutral INTEGER,
  missingness_json TEXT,
  data_quality REAL,
  content_hash TEXT,
  job_run_id TEXT,
  features_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_feat ON game_feature_snapshots (sport, game_id, feature_cutoff);

CREATE TABLE IF NOT EXISTS model_registry (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  name TEXT,
  version TEXT,
  role TEXT NOT NULL DEFAULT 'shadow',
  family TEXT,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  market_informed INTEGER NOT NULL DEFAULT 0,
  artifact_id TEXT,
  criteria_json TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'shadow'
);

CREATE TABLE IF NOT EXISTS model_artifacts (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  schema_json TEXT,
  coefficients_json TEXT,
  training_cutoff TEXT,
  training_hash TEXT,
  source_versions_json TEXT,
  validation_key TEXT,
  expected_units_json TEXT,
  r2_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_predictions (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  game_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT,
  role TEXT NOT NULL DEFAULT 'shadow',
  feature_snapshot_id TEXT,
  proj_home REAL,
  proj_away REAL,
  proj_margin REAL,
  proj_total REAL,
  p_home_win REAL,
  p_cover REAL,
  p_over REAL,
  sigma_margin REAL,
  sigma_total REAL,
  market_informed INTEGER DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  frozen_at TEXT NOT NULL,
  content_hash TEXT,
  actual_home REAL,
  actual_away REAL,
  graded_at TEXT,
  grade_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_model_pred_game ON model_predictions (sport, game_id, model_id);

CREATE TABLE IF NOT EXISTS model_validation_runs (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  method TEXT,
  train_until TEXT,
  validate_from TEXT,
  validate_until TEXT,
  n INTEGER,
  metrics_json TEXT,
  leakage_ok INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_promotion_decisions (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  operator_approved INTEGER NOT NULL DEFAULT 0,
  criteria_json TEXT,
  evidence_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  month TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  records_returned INTEGER,
  quota_cost INTEGER,
  ok INTEGER,
  reason TEXT,
  query_keys TEXT,
  elapsed_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_api_usage_month ON api_usage (month, source, endpoint);

CREATE TABLE IF NOT EXISTS team_season_identity (
  canonical_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  season INTEGER NOT NULL,
  source_team_id TEXT,
  espn_id TEXT,
  school TEXT,
  display_name TEXT,
  abbr TEXT,
  conference TEXT,
  classification TEXT,
  aliases_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (canonical_id, season)
);

INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0009_college_research', datetime('now'));
