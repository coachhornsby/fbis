-- NBA prospective market evaluation + qualification evidence.
CREATE TABLE IF NOT EXISTS nba_game_market_evaluations (
  id TEXT PRIMARY KEY,
  projection_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT,
  checkpoint TEXT,
  market_type TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_line REAL,
  entry_price REAL,
  entry_no_vig REAL,
  entry_captured_at TEXT,
  close_line REAL,
  close_price REAL,
  close_no_vig REAL,
  close_captured_at TEXT,
  model_probability REAL,
  edge_probability REAL,
  expected_value REAL,
  line_clv REAL,
  probability_clv REAL,
  actual_home REAL,
  actual_away REAL,
  result TEXT,
  profit_units REAL,
  qualified INTEGER NOT NULL DEFAULT 0,
  qualification_reason TEXT,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  evaluated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_game_eval_game ON nba_game_market_evaluations(game_id, market_type, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_nba_game_eval_qual ON nba_game_market_evaluations(qualified, result, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS nba_prop_market_evaluations (
  id TEXT PRIMARY KEY,
  projection_id TEXT NOT NULL,
  game_id TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  market_type TEXT NOT NULL,
  candidate_side TEXT,
  projection REAL,
  sigma REAL,
  entry_line REAL,
  entry_observed_at TEXT,
  close_line REAL,
  close_observed_at TEXT,
  line_edge REAL,
  standardized_edge REAL,
  model_probability REAL,
  actual_value REAL,
  result TEXT,
  line_clv REAL,
  qualified INTEGER NOT NULL DEFAULT 0,
  qualification_reason TEXT,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  evaluated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_prop_eval_player ON nba_prop_market_evaluations(player_name, market_type, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_nba_prop_eval_qual ON nba_prop_market_evaluations(qualified, result, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS nba_qualification_state (
  model_id TEXT PRIMARY KEY,
  can_qualify INTEGER NOT NULL DEFAULT 1,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  prospective_n INTEGER NOT NULL DEFAULT 0,
  graded_n INTEGER NOT NULL DEFAULT 0,
  qualified_n INTEGER NOT NULL DEFAULT 0,
  positive_clv_rate REAL,
  roi_units REAL,
  roi_pct REAL,
  status TEXT NOT NULL DEFAULT 'QUALIFICATION_ENABLED',
  gates_json TEXT,
  evaluated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0041_nba_market_qualification', datetime('now'));
