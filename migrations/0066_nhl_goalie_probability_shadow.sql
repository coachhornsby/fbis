-- NHL goalie probability prospective shadow freeze/grade ledger.
-- Research only. Never grants qualification, wager authority, or staking.

CREATE TABLE IF NOT EXISTS nhl_goalie_probability_shadow (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  game_start TEXT,
  feature_cutoff_timestamp TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  incumbent_model_id TEXT NOT NULL,
  gate_id TEXT NOT NULL,
  gate_fired INTEGER NOT NULL DEFAULT 0,
  historical_gate_validated INTEGER NOT NULL DEFAULT 0,
  goalie_probability_scale REAL NOT NULL,
  incumbent_home_win_probability REAL,
  shadow_home_win_probability REAL,
  projected_home REAL,
  projected_away REAL,
  goalie_state_json TEXT,
  ev_deployment_json TEXT,
  pp_deployment_json TEXT,
  scratches_availability_json TEXT,
  replacement_mapping_json TEXT,
  persistent_state_json TEXT,
  market_snapshot_json TEXT,
  code_sha TEXT,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  staking_authorized INTEGER NOT NULL DEFAULT 0,
  actual_home REAL,
  actual_away REAL,
  incumbent_brier REAL,
  shadow_brier REAL,
  incumbent_log_loss REAL,
  shadow_log_loss REAL,
  incumbent_correct INTEGER,
  shadow_correct INTEGER,
  research_clv_probability_pp REAL,
  research_profit_units REAL,
  grade_json TEXT,
  graded_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(event_id,model_version)
);
CREATE INDEX IF NOT EXISTS idx_nhl_goalie_shadow_event
  ON nhl_goalie_probability_shadow(event_id,feature_cutoff_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_nhl_goalie_shadow_grade
  ON nhl_goalie_probability_shadow(graded_at,feature_cutoff_timestamp);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0066_nhl_goalie_probability_shadow',datetime('now'));
