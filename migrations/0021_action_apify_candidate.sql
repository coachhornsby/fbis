-- Action/Apify PRODUCTION-CANDIDATE operational layer (additive).
-- Shadow/candidate only. Never grants canQualify / canAuthorizeWager.
-- Never enters ODDS_PROVIDER_ORDER. Never feeds CFB-FBIS-v2 features.

CREATE TABLE IF NOT EXISTS shadow_collection_runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'ACTION_APIFY',
  mode TEXT NOT NULL DEFAULT 'shadow',
  plan TEXT NOT NULL,
  profile TEXT NOT NULL,
  sport TEXT NOT NULL,
  lifecycle TEXT,
  status TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  overlap_blocked INTEGER NOT NULL DEFAULT 0,
  budget_blocked INTEGER NOT NULL DEFAULT 0,
  circuit_open INTEGER NOT NULL DEFAULT 0,
  apify_run_id TEXT,
  dataset_id TEXT,
  requested_max_items INTEGER,
  games_expected INTEGER,
  games_returned INTEGER,
  games_matched INTEGER,
  games_unmatched INTEGER,
  observations_written INTEGER,
  duplicates_skipped INTEGER,
  malformed_rows INTEGER,
  schema_fingerprint TEXT,
  schema_drift_level TEXT,
  estimated_cost_usd REAL,
  actual_cost_usd REAL,
  cost_basis TEXT,
  error_class TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shadow_collection_runs_sport_started
  ON shadow_collection_runs (sport, started_at);
CREATE INDEX IF NOT EXISTS idx_shadow_collection_runs_status
  ON shadow_collection_runs (status, started_at);

CREATE TABLE IF NOT EXISTS shadow_cost_ledger (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  sport TEXT,
  profile TEXT,
  cost_basis TEXT NOT NULL,
  run_start_usd REAL NOT NULL DEFAULT 0,
  scoreboard_usd REAL NOT NULL DEFAULT 0,
  row_usd REAL NOT NULL DEFAULT 0,
  movement_usd REAL NOT NULL DEFAULT 0,
  player_props_usd REAL NOT NULL DEFAULT 0,
  game_props_usd REAL NOT NULL DEFAULT 0,
  detail_usd REAL NOT NULL DEFAULT 0,
  weather_usd REAL NOT NULL DEFAULT 0,
  injuries_usd REAL NOT NULL DEFAULT 0,
  standings_usd REAL NOT NULL DEFAULT 0,
  futures_usd REAL NOT NULL DEFAULT 0,
  estimated_total_usd REAL NOT NULL DEFAULT 0,
  actual_total_usd REAL,
  delta_usd REAL,
  games_returned INTEGER,
  features_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES shadow_collection_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_shadow_cost_ledger_created
  ON shadow_cost_ledger (created_at);
CREATE INDEX IF NOT EXISTS idx_shadow_cost_ledger_run
  ON shadow_cost_ledger (run_id);

CREATE TABLE IF NOT EXISTS shadow_provider_reliability (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sport TEXT,
  profile TEXT,
  success INTEGER NOT NULL,
  http_status INTEGER,
  actor_failure INTEGER NOT NULL DEFAULT 0,
  api_failure INTEGER NOT NULL DEFAULT 0,
  malformed_payload INTEGER NOT NULL DEFAULT 0,
  empty_run INTEGER NOT NULL DEFAULT 0,
  partial_run INTEGER NOT NULL DEFAULT 0,
  schema_violation INTEGER NOT NULL DEFAULT 0,
  timeout INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  games_expected INTEGER,
  games_returned INTEGER,
  unmatched_games INTEGER,
  duplicate_rows INTEGER,
  error_class TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES shadow_collection_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_shadow_reliability_created
  ON shadow_provider_reliability (created_at);
CREATE INDEX IF NOT EXISTS idx_shadow_reliability_run
  ON shadow_provider_reliability (run_id);

CREATE TABLE IF NOT EXISTS shadow_schema_fingerprints (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  schema_version TEXT,
  fingerprint TEXT NOT NULL,
  top_level_keys_json TEXT,
  required_fields_json TEXT,
  drift_level TEXT NOT NULL,
  drift_notes_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shadow_schema_fp_created
  ON shadow_schema_fingerprints (created_at);

CREATE TABLE IF NOT EXISTS shadow_promotion_metrics (
  id TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  sport TEXT,
  readiness_status TEXT NOT NULL,
  coverage_json TEXT,
  accuracy_json TEXT,
  freshness_json TEXT,
  history_json TEXT,
  intelligence_json TEXT,
  reliability_json TEXT,
  economics_json TEXT,
  blockers_json TEXT,
  sample_sizes_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shadow_promotion_metrics_created
  ON shadow_promotion_metrics (created_at);

CREATE TABLE IF NOT EXISTS shadow_dead_letters (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  error_class TEXT NOT NULL,
  error_message TEXT,
  payload_hash TEXT,
  payload_excerpt TEXT,
  sport TEXT,
  profile TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shadow_dead_letters_created
  ON shadow_dead_letters (created_at);

-- Observation natural-key uniqueness helper for idempotent candidate upserts.
CREATE TABLE IF NOT EXISTS shadow_observation_keys (
  natural_key TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  action_game_id TEXT,
  market TEXT,
  period TEXT,
  book TEXT,
  source_observed_at TEXT,
  collected_at TEXT,
  payload_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shadow_obs_keys_game
  ON shadow_observation_keys (action_game_id, market, period, book);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0021_action_apify_candidate', datetime('now'));
