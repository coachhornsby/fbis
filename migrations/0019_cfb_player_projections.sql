-- CFB player projections (QB1/RB1/WR1) + prop market comparison layer.
-- Additive only. Shadow research tables — never alter champion projection storage.

CREATE TABLE IF NOT EXISTS cfb_player_role_snapshots (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  season INTEGER,
  week INTEGER,
  season_type TEXT,
  kickoff_timestamp TEXT,
  team TEXT NOT NULL,
  side TEXT NOT NULL,
  role TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT,
  position TEXT,
  role_confidence REAL,
  identity_as_of TEXT NOT NULL,
  feature_cutoff_timestamp TEXT NOT NULL,
  selection_json TEXT,
  provenance_json TEXT,
  model_version TEXT,
  content_hash TEXT,
  job_run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cfb_player_role_game
  ON cfb_player_role_snapshots (game_id, role);

CREATE INDEX IF NOT EXISTS idx_cfb_player_role_team
  ON cfb_player_role_snapshots (team, season, week);

CREATE TABLE IF NOT EXISTS cfb_player_projections (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  season INTEGER,
  week INTEGER,
  kickoff_timestamp TEXT,
  team TEXT NOT NULL,
  side TEXT NOT NULL,
  role TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT,
  market_type TEXT NOT NULL,
  projection REAL,
  median REAL,
  sigma REAL,
  quantiles_json TEXT,
  data_quality REAL,
  sample_size INTEGER,
  uncertainty_state TEXT,
  model_id TEXT NOT NULL,
  model_version TEXT,
  game_model_id TEXT,
  game_model_version TEXT,
  feature_cutoff_timestamp TEXT NOT NULL,
  feature_as_of_timestamp TEXT,
  provenance_json TEXT,
  coherence_json TEXT,
  content_hash TEXT,
  job_run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cfb_player_proj_game
  ON cfb_player_projections (game_id, role, market_type);

CREATE TABLE IF NOT EXISTS cfb_prop_market_lines (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT,
  team TEXT,
  market_type TEXT NOT NULL,
  line REAL NOT NULL,
  over_price REAL,
  under_price REAL,
  source TEXT NOT NULL,
  sportsbook TEXT,
  observed_at TEXT NOT NULL,
  market_quality TEXT,
  import_mode TEXT,
  payload_json TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cfb_prop_market_game
  ON cfb_prop_market_lines (game_id, market_type, source);

CREATE TABLE IF NOT EXISTS cfb_player_prop_comparisons (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  projection_id TEXT,
  market_line_id TEXT,
  player_id TEXT,
  player_name TEXT,
  market_type TEXT NOT NULL,
  fbis_projection REAL,
  market_line REAL,
  difference REAL,
  standardized_diff REAL,
  probability_over REAL,
  probability_under REAL,
  source TEXT,
  correlation_tags_json TEXT,
  decision_eligible INTEGER NOT NULL DEFAULT 0,
  model_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cfb_player_prop_cmp_game
  ON cfb_player_prop_comparisons (game_id, market_type);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0019_cfb_player_projections', datetime('now'));
