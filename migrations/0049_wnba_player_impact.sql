-- 0049_wnba_player_impact.sql
CREATE TABLE IF NOT EXISTS wnba_player_impact_snapshots (
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
  bpm_style REAL,
  vorp_style REAL,
  ws48_style REAL,
  dynamic_skill_json TEXT,
  provenance_json TEXT,
  production_eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_impact_player_time ON wnba_player_impact_snapshots(player_id,as_of DESC);
CREATE INDEX IF NOT EXISTS idx_wnba_impact_team_time ON wnba_player_impact_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS wnba_player_role_contexts (
  id TEXT PRIMARY KEY,
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
  actual_home REAL,
  actual_away REAL,
  baseline_margin_abs_error REAL,
  impact_margin_abs_error REAL,
  baseline_total_abs_error REAL,
  impact_total_abs_error REAL,
  graded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_role_player_time ON wnba_player_role_contexts(player_id,feature_cutoff_timestamp DESC);

CREATE TABLE IF NOT EXISTS wnba_player_prop_impact_shadow (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_start TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  market_type TEXT NOT NULL,
  feature_cutoff_timestamp TEXT NOT NULL,
  baseline_projection REAL,
  impact_projection REAL,
  sigma REAL,
  projected_minutes REAL,
  player_impact_net REAL,
  availability_verified INTEGER NOT NULL DEFAULT 0,
  role_context_json TEXT,
  lineup_context_json TEXT,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  entry_line REAL,
  entry_observed_at TEXT,
  close_line REAL,
  close_observed_at TEXT,
  actual_value REAL,
  baseline_abs_error REAL,
  impact_abs_error REAL,
  baseline_side TEXT,
  impact_side TEXT,
  impact_probability REAL,
  line_clv REAL,
  graded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_impact_shadow_event ON wnba_player_prop_impact_shadow(event_id,player_name,market_type);
CREATE INDEX IF NOT EXISTS idx_wnba_impact_shadow_grade ON wnba_player_prop_impact_shadow(graded_at,feature_cutoff_timestamp);

CREATE TABLE IF NOT EXISTS wnba_game_impact_shadow (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_start TEXT,
  feature_cutoff_timestamp TEXT NOT NULL,
  baseline_home REAL,
  baseline_away REAL,
  baseline_margin REAL,
  baseline_total REAL,
  impact_home REAL,
  impact_away REAL,
  impact_margin REAL,
  impact_total REAL,
  home_adjustment REAL,
  away_adjustment REAL,
  availability_verified INTEGER NOT NULL DEFAULT 0,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  context_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_game_impact_event ON wnba_game_impact_shadow(event_id,feature_cutoff_timestamp DESC);

CREATE TABLE IF NOT EXISTS wnba_player_impact_validation (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  validation_type TEXT NOT NULL,
  market_type TEXT NOT NULL,
  n INTEGER NOT NULL,
  baseline_mae REAL,
  impact_mae REAL,
  mae_delta REAL,
  baseline_side_accuracy REAL,
  impact_side_accuracy REAL,
  side_accuracy_delta REAL,
  positive_clv_rate REAL,
  passed INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0049_wnba_player_impact',datetime('now'));
