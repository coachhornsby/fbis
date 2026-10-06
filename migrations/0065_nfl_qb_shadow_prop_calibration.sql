-- NFL prospective QB-personnel shadow + point-in-time prop state freeze.
-- Shadow rows are append-only. They never modify the NFL-PRO champion or wager authority.

CREATE TABLE IF NOT EXISTS nfl_qb_personnel_shadow_predictions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  season INTEGER,
  week INTEGER,
  start_time TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  frozen_at TEXT NOT NULL,

  champion_governance_id TEXT NOT NULL,
  incumbent_model_id TEXT,
  incumbent_model_version TEXT,
  incumbent_home REAL NOT NULL,
  incumbent_away REAL NOT NULL,
  incumbent_margin REAL NOT NULL,
  incumbent_win_probability REAL,
  incumbent_total REAL NOT NULL,

  challenger_model_id TEXT NOT NULL,
  challenger_home REAL NOT NULL,
  challenger_away REAL NOT NULL,
  challenger_margin REAL NOT NULL,
  challenger_win_probability REAL,
  challenger_total REAL NOT NULL,
  margin_correction REAL NOT NULL DEFAULT 0,

  combined_qb_burden REAL NOT NULL,
  home_qb_burden REAL NOT NULL,
  away_qb_burden REAL NOT NULL,
  gate_threshold REAL NOT NULL,
  gate_fired INTEGER NOT NULL DEFAULT 0,

  executable_market_json TEXT,
  home_profile_json TEXT,
  away_profile_json TEXT,
  personnel_json TEXT,
  provenance_json TEXT NOT NULL,

  actual_home REAL,
  actual_away REAL,
  actual_margin REAL,
  actual_total REAL,
  closing_market_json TEXT,
  incumbent_margin_abs_error REAL,
  challenger_margin_abs_error REAL,
  incumbent_winner_correct INTEGER,
  challenger_winner_correct INTEGER,
  incumbent_brier REAL,
  challenger_brier REAL,
  incumbent_log_loss REAL,
  challenger_log_loss REAL,
  incumbent_ats_result TEXT,
  challenger_ats_result TEXT,
  incumbent_roi_units REAL,
  challenger_roi_units REAL,
  incumbent_clv REAL,
  challenger_clv REAL,
  graded_at TEXT,

  lifecycle TEXT NOT NULL DEFAULT 'SHADOW',
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(event_id, checkpoint)
);

CREATE INDEX IF NOT EXISTS idx_nfl_qb_shadow_start
  ON nfl_qb_personnel_shadow_predictions(start_time, graded_at);
CREATE INDEX IF NOT EXISTS idx_nfl_qb_shadow_gate
  ON nfl_qb_personnel_shadow_predictions(gate_fired, start_time);
CREATE INDEX IF NOT EXISTS idx_nfl_qb_shadow_week
  ON nfl_qb_personnel_shadow_predictions(season, week, checkpoint);

CREATE TABLE IF NOT EXISTS nfl_prop_state_snapshots (
  id TEXT PRIMARY KEY,
  prop_line_id TEXT NOT NULL UNIQUE,
  run_id TEXT,
  projection_id TEXT,
  event_id TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team_key TEXT,
  market TEXT,
  line REAL,
  odds_tier TEXT,
  line_observed_at TEXT,
  collected_at TEXT NOT NULL,

  health_state TEXT,
  practice_state TEXT,
  injury_detail TEXT,
  injury_type TEXT,
  injury_severity_class TEXT,
  expected_return_state TEXT,
  last_known_snap_share REAL,
  expected_snap_share REAL,
  depth_rank INTEGER,
  role_label TEXT,
  state_confidence REAL,
  carried_state INTEGER NOT NULL DEFAULT 0,
  state_source TEXT,
  state_source_updated_at TEXT,
  player_profile_updated_at TEXT,

  player_state_json TEXT,
  injury_evidence_json TEXT,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nfl_prop_state_player_time
  ON nfl_prop_state_snapshots(player_name, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_nfl_prop_state_event
  ON nfl_prop_state_snapshots(event_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_nfl_prop_state_market
  ON nfl_prop_state_snapshots(market, collected_at DESC);

CREATE TABLE IF NOT EXISTS nfl_prop_market_calibration_runs (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT,
  evaluated_at TEXT NOT NULL,
  market TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  walk_forward_n INTEGER NOT NULL,
  bias REAL,
  empirical_sigma REAL,
  raw_brier REAL,
  raw_log_loss REAL,
  raw_ece REAL,
  calibrated_brier REAL,
  calibrated_log_loss REAL,
  calibrated_ece REAL,
  monotonic INTEGER NOT NULL DEFAULT 0,
  validated INTEGER NOT NULL DEFAULT 0,
  validation_reason TEXT,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nfl_prop_calibration_market
  ON nfl_prop_market_calibration_runs(market, evaluated_at DESC);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0065_nfl_qb_shadow_prop_calibration', datetime('now'));
