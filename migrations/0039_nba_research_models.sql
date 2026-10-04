-- NBA-FBIS-v1 and NBA-PLAYER-PROP-v1 research storage.
CREATE TABLE IF NOT EXISTS nba_game_features (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, feature_cutoff_timestamp TEXT NOT NULL,
  home_team TEXT NOT NULL, away_team TEXT NOT NULL, feature_json TEXT NOT NULL,
  source_manifest_json TEXT, content_hash TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_game_features_game ON nba_game_features(game_id, feature_cutoff_timestamp);

CREATE TABLE IF NOT EXISTS nba_game_projections (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, tipoff_timestamp TEXT,
  model_id TEXT NOT NULL, model_version TEXT, feature_cutoff_timestamp TEXT NOT NULL,
  projected_home REAL, projected_away REAL, projected_margin REAL, projected_total REAL,
  expected_possessions REAL, p_home_win REAL, sigma_margin REAL, sigma_total REAL,
  maturity TEXT NOT NULL DEFAULT 'RESEARCH', can_qualify INTEGER NOT NULL DEFAULT 1,
  can_authorize INTEGER NOT NULL DEFAULT 0, provenance_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_game_proj_game ON nba_game_projections(game_id, created_at DESC);

CREATE TABLE IF NOT EXISTS nba_player_game_features (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, player_id TEXT, player_name TEXT NOT NULL,
  team TEXT NOT NULL, feature_cutoff_timestamp TEXT NOT NULL, feature_json TEXT NOT NULL,
  provenance_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_player_features_game ON nba_player_game_features(game_id, player_name);

CREATE TABLE IF NOT EXISTS nba_player_prop_projections (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, player_id TEXT, player_name TEXT NOT NULL,
  team TEXT NOT NULL, market_type TEXT NOT NULL, projection REAL, sigma REAL, projected_minutes REAL,
  availability_status TEXT, model_id TEXT NOT NULL, model_version TEXT,
  feature_cutoff_timestamp TEXT NOT NULL, maturity TEXT NOT NULL DEFAULT 'RESEARCH',
  can_qualify INTEGER NOT NULL DEFAULT 1, can_authorize INTEGER NOT NULL DEFAULT 0,
  provenance_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_prop_proj_game ON nba_player_prop_projections(game_id, player_name, market_type);

CREATE TABLE IF NOT EXISTS nba_prop_comparisons (
  id TEXT PRIMARY KEY, projection_id TEXT, game_id TEXT NOT NULL, player_id TEXT, player_name TEXT NOT NULL,
  market_type TEXT NOT NULL, source TEXT NOT NULL, market_line REAL NOT NULL,
  observed_at TEXT NOT NULL, fbis_projection REAL, sigma REAL, difference REAL,
  probability_over REAL, probability_under REAL, candidate_side TEXT,
  decision_eligible INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_prop_cmp_game ON nba_prop_comparisons(game_id, player_name, market_type, observed_at DESC);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0039_nba_research_models', datetime('now'));
