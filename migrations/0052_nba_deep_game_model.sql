-- NBA deep game-model challenger: Four Factors, shot profile, lineup and real travel/rest.
CREATE TABLE IF NOT EXISTS nba_deep_game_shadow (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  tipoff_timestamp TEXT,
  feature_cutoff_timestamp TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  incumbent_model_id TEXT NOT NULL,
  projected_home REAL,
  projected_away REAL,
  projected_margin REAL,
  projected_total REAL,
  expected_possessions REAL,
  p_home_win REAL,
  sigma_margin REAL,
  sigma_total REAL,
  incumbent_margin REAL,
  incumbent_total REAL,
  margin_adjustment REAL,
  total_adjustment REAL,
  availability_verified INTEGER NOT NULL DEFAULT 0,
  feature_json TEXT,
  decomposition_json TEXT,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  actual_home REAL,
  actual_away REAL,
  margin_abs_error REAL,
  total_abs_error REAL,
  incumbent_margin_abs_error REAL,
  incumbent_total_abs_error REAL,
  graded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_deep_shadow_game
  ON nba_deep_game_shadow(game_id,feature_cutoff_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_nba_deep_shadow_grade
  ON nba_deep_game_shadow(graded_at,feature_cutoff_timestamp);

CREATE TABLE IF NOT EXISTS nba_deep_validation_runs (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  validation_type TEXT NOT NULL,
  training_start TEXT,
  training_cutoff TEXT,
  holdout_start TEXT,
  n INTEGER NOT NULL,
  incumbent_margin_mae REAL,
  challenger_margin_mae REAL,
  margin_improvement REAL,
  incumbent_total_mae REAL,
  challenger_total_mae REAL,
  total_improvement REAL,
  incumbent_winner_accuracy REAL,
  challenger_winner_accuracy REAL,
  evidence_pass INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_deep_validation_created
  ON nba_deep_validation_runs(created_at DESC);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0052_nba_deep_game_model',datetime('now'));
