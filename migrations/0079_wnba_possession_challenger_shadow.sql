-- 0079_wnba_possession_challenger_shadow.sql
-- Prospective, point-in-time WNBA possession-aware challenger state.
-- Research-only. Incumbent WNBA-FBIS-v2 / WNBA-PLAYER-PROJ-v2 remain authoritative.

CREATE TABLE IF NOT EXISTS wnba_possession_challenger_coefficients (
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  target TEXT NOT NULL,
  intercept REAL NOT NULL,
  slope REAL NOT NULL,
  train_n INTEGER NOT NULL,
  source_checkpoint TEXT NOT NULL,
  source_generated_at TEXT,
  frozen_at TEXT NOT NULL,
  details_json TEXT,
  production_eligible INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(model_id,target)
);

CREATE TABLE IF NOT EXISTS wnba_team_possession_feature_snapshots (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  as_of TEXT NOT NULL,
  model_version TEXT NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  close_possessions REAL,
  close_ortg REAL,
  close_ortg_shrunk REAL,
  reconstructed_pace REAL,
  pace_stability REAL,
  lineup_net100 REAL,
  lineup_possessions REAL,
  lineup_duration_coverage REAL,
  substitution_resolution REAL,
  lineup_reliability REAL,
  feature_json TEXT NOT NULL,
  market_informed INTEGER NOT NULL DEFAULT 0,
  production_eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_team_possession_feature_team_time
  ON wnba_team_possession_feature_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS wnba_game_possession_challenger_shadow (
  id TEXT PRIMARY KEY,
  natural_key TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL,
  event_start TEXT,
  captured_at TEXT NOT NULL,
  feature_cutoff_timestamp TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  baseline_home REAL,
  baseline_away REAL,
  baseline_margin REAL,
  baseline_total REAL,
  challenger_home REAL,
  challenger_away REAL,
  challenger_margin REAL,
  challenger_total REAL,
  sigma_margin REAL,
  sigma_total REAL,
  home_feature_value REAL,
  away_feature_value REAL,
  feature_delta REAL,
  feature_reliability REAL,
  lineup_reliability REAL,
  feature_json TEXT NOT NULL,
  market_informed INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  actual_home REAL,
  actual_away REAL,
  baseline_margin_abs_error REAL,
  challenger_margin_abs_error REAL,
  baseline_total_abs_error REAL,
  challenger_total_abs_error REAL,
  winner_brier_baseline REAL,
  winner_brier_challenger REAL,
  graded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_possession_shadow_event
  ON wnba_game_possession_challenger_shadow(event_id,captured_at);
CREATE INDEX IF NOT EXISTS idx_wnba_possession_shadow_model_grade
  ON wnba_game_possession_challenger_shadow(model_id,graded_at,captured_at);

CREATE TABLE IF NOT EXISTS wnba_game_possession_market_shadow (
  id TEXT PRIMARY KEY,
  natural_key TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL,
  event_start TEXT,
  captured_at TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  market TEXT NOT NULL,
  side TEXT NOT NULL,
  line REAL,
  american_price REAL NOT NULL,
  sportsbook TEXT,
  market_observed_at TEXT,
  model_probability REAL,
  break_even_probability REAL,
  probability_edge REAL,
  expected_value REAL,
  research_decision TEXT NOT NULL,
  feature_reliability REAL,
  lineup_reliability REAL,
  result TEXT,
  win INTEGER,
  push INTEGER,
  units REAL,
  close_line REAL,
  close_price REAL,
  clv_line REAL,
  clv_price REAL,
  settled_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_possession_market_shadow_event
  ON wnba_game_possession_market_shadow(event_id,captured_at);
CREATE INDEX IF NOT EXISTS idx_wnba_possession_market_shadow_model
  ON wnba_game_possession_market_shadow(model_id,market,research_decision,settled_at);

CREATE TABLE IF NOT EXISTS wnba_player_opportunity_shadow (
  id TEXT PRIMARY KEY,
  natural_key TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL,
  event_start TEXT,
  captured_at TEXT NOT NULL,
  feature_cutoff_timestamp TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team_id TEXT,
  market_type TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  baseline_projection REAL,
  opportunity_projection REAL,
  sigma REAL,
  projected_minutes_mean REAL,
  projected_minutes_sd REAL,
  usage_mean REAL,
  usage_sd REAL,
  fga_mean REAL,
  fga_sd REAL,
  tpa_mean REAL,
  tpa_sd REAL,
  rebound_opp_mean REAL,
  rebound_opp_sd REAL,
  assist_opp_mean REAL,
  assist_opp_sd REAL,
  availability_verified INTEGER NOT NULL DEFAULT 0,
  expected_teammates_json TEXT,
  opportunity_json TEXT NOT NULL,
  market_informed INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  entry_line REAL,
  entry_observed_at TEXT,
  actual_value REAL,
  baseline_abs_error REAL,
  opportunity_abs_error REAL,
  graded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_player_opportunity_event
  ON wnba_player_opportunity_shadow(event_id,player_name,market_type,captured_at);
CREATE INDEX IF NOT EXISTS idx_wnba_player_opportunity_grade
  ON wnba_player_opportunity_shadow(graded_at,feature_cutoff_timestamp);

CREATE TABLE IF NOT EXISTS wnba_player_opportunity_validation (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  market_type TEXT NOT NULL,
  n INTEGER NOT NULL,
  baseline_mae REAL,
  opportunity_mae REAL,
  mae_delta REAL,
  availability_verified_n INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  decision TEXT NOT NULL DEFAULT 'CONTINUE_SHADOW',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wnba_possession_challenger_validation (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  validation_type TEXT NOT NULL,
  n INTEGER NOT NULL,
  baseline_margin_mae REAL,
  challenger_margin_mae REAL,
  margin_mae_delta REAL,
  baseline_total_mae REAL,
  challenger_total_mae REAL,
  total_mae_delta REAL,
  baseline_brier REAL,
  challenger_brier REAL,
  brier_delta REAL,
  lineup_reliability_threshold REAL,
  reliable_n INTEGER,
  details_json TEXT,
  decision TEXT NOT NULL DEFAULT 'CONTINUE_SHADOW',
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0079_wnba_possession_challenger_shadow',datetime('now'));
