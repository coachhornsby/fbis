-- NBA player impact, lineup and role-redistribution research state.
CREATE TABLE IF NOT EXISTS nba_player_impact_snapshots (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  player_name TEXT,
  team_id TEXT,
  position TEXT,
  as_of TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  offense_impact REAL,
  defense_impact REAL,
  net_impact REAL,
  rapm_net REAL,
  raw_on_off REAL,
  bpm_style REAL,
  vorp_style REAL,
  ws48_style REAL,
  dynamic_skill_json TEXT,
  provenance_json TEXT,
  production_eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_impact_player_time
  ON nba_player_impact_snapshots(player_id,as_of DESC);
CREATE INDEX IF NOT EXISTS idx_nba_impact_team_time
  ON nba_player_impact_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS nba_player_role_contexts (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  player_id TEXT NOT NULL,
  player_name TEXT,
  team_id TEXT,
  feature_cutoff_timestamp TEXT NOT NULL,
  minutes_delta REAL,
  usage_multiplier REAL,
  points_multiplier REAL,
  rebounds_multiplier REAL,
  assists_multiplier REAL,
  threes_multiplier REAL,
  lineup_multiplier REAL,
  unavailable_count INTEGER NOT NULL DEFAULT 0,
  availability_verified INTEGER NOT NULL DEFAULT 0,
  context_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_role_context_game
  ON nba_player_role_contexts(game_id,player_id,feature_cutoff_timestamp DESC);

CREATE TABLE IF NOT EXISTS nba_player_impact_validation (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  training_window TEXT,
  holdout_window TEXT,
  market_type TEXT NOT NULL,
  n INTEGER NOT NULL,
  baseline_mae REAL,
  impact_mae REAL,
  mae_delta REAL,
  baseline_bias REAL,
  impact_bias REAL,
  passed INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations (id,applied_at)
VALUES ('0048_nba_player_impact',datetime('now'));
