-- NBA game-level wagering decision architecture.
CREATE TABLE IF NOT EXISTS nba_wager_decisions (
  id TEXT PRIMARY KEY,
  projection_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT,
  decision_timestamp TEXT NOT NULL,
  market_type TEXT NOT NULL,
  side TEXT NOT NULL,
  offered_line REAL,
  offered_price REAL,
  model_probability REAL,
  break_even_probability REAL,
  probability_edge REAL,
  expected_value REAL,
  projection_uncertainty REAL,
  matchup_reliability REAL,
  data_quality REAL,
  historical_factor_reliability REAL,
  market_confirmation TEXT,
  fbis_confidence REAL,
  confidence_status TEXT,
  confidence_decision_eligible INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL,
  qualification_eligible INTEGER NOT NULL DEFAULT 0,
  stake_units REAL,
  stake_status TEXT NOT NULL DEFAULT 'UNVALIDATED',
  decomposition_json TEXT,
  market_trajectory_json TEXT,
  action_intelligence_json TEXT,
  historical_context_json TEXT,
  safeguards_json TEXT,
  reasons_json TEXT,
  actual_home REAL,
  actual_away REAL,
  close_line REAL,
  close_price REAL,
  clv_line REAL,
  clv_probability REAL,
  result TEXT,
  profit_units REAL,
  graded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_wager_decision_game
  ON nba_wager_decisions(game_id, decision_timestamp);
CREATE INDEX IF NOT EXISTS idx_nba_wager_decision_state
  ON nba_wager_decisions(decision, qualification_eligible, graded_at);

CREATE TABLE IF NOT EXISTS nba_confidence_calibration (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT,
  market_type TEXT,
  sample_n INTEGER NOT NULL,
  bins_json TEXT NOT NULL,
  brier_score REAL,
  log_loss REAL,
  roi_pct REAL,
  positive_clv_rate REAL,
  monotonicity_pass INTEGER NOT NULL DEFAULT 0,
  monotonicity_details_json TEXT,
  training_cutoff TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_confidence_cal_model
  ON nba_confidence_calibration(model_id, market_type, created_at DESC);

CREATE TABLE IF NOT EXISTS nba_decision_validation_runs (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT,
  window_start TEXT,
  window_end TEXT,
  prospective_n INTEGER NOT NULL DEFAULT 0,
  graded_n INTEGER NOT NULL DEFAULT 0,
  bet_n INTEGER NOT NULL DEFAULT 0,
  units REAL,
  roi_pct REAL,
  max_drawdown_units REAL,
  positive_clv_rate REAL,
  calibration_json TEXT,
  confidence_monotonicity_json TEXT,
  season_stability_json TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0042_nba_game_level_decision', datetime('now'));
