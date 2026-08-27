-- FBIS research store (Cloudflare D1). Cache is not a substitute.
-- Apply: wrangler d1 execute fbis --file=schema.sql --remote

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  date TEXT NOT NULL,
  start TEXT,
  home_name TEXT,
  away_name TEXT,
  home_abbr TEXT,
  away_abbr TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_versions (
  version TEXT PRIMARY KEY,
  sport TEXT,
  weights_json TEXT,
  created_at TEXT NOT NULL,
  status TEXT DEFAULT 'champion'
);

CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  date TEXT NOT NULL,
  matchup TEXT,
  checkpoint TEXT,
  model_version TEXT,
  as_of TEXT NOT NULL,
  proj_home REAL,
  proj_away REAL,
  proj_total REAL,
  proj_margin REAL,
  pal_home REAL,
  pal_away REAL,
  p_home_final REAL,
  p_away_final REAL,
  p_market REAL,
  p_espn REAL,
  p_score REAL,
  p_form REAL,
  p_pal REAL,
  weights_json TEXT,
  layers_json TEXT,
  pal_json TEXT,
  pal_as_of TEXT,
  lineups_official INTEGER,
  data_quality INTEGER,
  pin_home_ml REAL,
  pin_away_ml REAL,
  pin_vig REAL,
  engine TEXT,
  actual_home REAL,
  actual_away REAL,
  graded_at TEXT
);

CREATE TABLE IF NOT EXISTS prediction_snapshots (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  date TEXT NOT NULL,
  matchup TEXT,
  checkpoint TEXT NOT NULL,
  model_version TEXT,
  frozen_at TEXT NOT NULL,
  proj_home REAL,
  proj_away REAL,
  proj_total REAL,
  proj_margin REAL,
  pal_home REAL,
  pal_away REAL,
  pal_f5_home REAL,
  pal_f5_away REAL,
  pal_p_home REAL,
  pal_as_of TEXT,
  pal_request_id TEXT,
  pal_json TEXT,
  lineups_official INTEGER,
  p_home_final REAL,
  p_market REAL,
  p_espn REAL,
  p_score REAL,
  p_form REAL,
  p_pal REAL,
  weights_json TEXT,
  layers_json TEXT,
  data_quality INTEGER,
  pin_home_ml REAL,
  pin_away_ml REAL,
  pin_vig REAL,
  engine TEXT,
  actual_home REAL,
  actual_away REAL,
  graded_at TEXT
);

CREATE TABLE IF NOT EXISTS prediction_layers (
  prediction_id TEXT NOT NULL,
  layer TEXT NOT NULL,
  p_home REAL,
  PRIMARY KEY (prediction_id, layer)
);

CREATE TABLE IF NOT EXISTS odds_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  date TEXT,
  book TEXT,
  market TEXT,
  side TEXT,
  line REAL,
  price REAL,
  implied REAL,
  no_vig REAL,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  date TEXT NOT NULL,
  sport TEXT NOT NULL,
  model_version TEXT NOT NULL DEFAULT '',
  checkpoint TEXT NOT NULL DEFAULT 'LATEST',
  n INTEGER,
  brier REAL,
  log_loss REAL,
  mae_total REAL,
  mae_margin REAL,
  winner_hit REAL,
  PRIMARY KEY (date, sport, model_version, checkpoint)
);

CREATE TABLE IF NOT EXISTS store_meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE TABLE IF NOT EXISTS team_form (
  sport TEXT NOT NULL,
  season INTEGER NOT NULL,
  team_key TEXT NOT NULL,
  games INTEGER,
  points_for REAL,
  points_against REAL,
  updated_at TEXT,
  PRIMARY KEY (sport, season, team_key)
);

CREATE TABLE IF NOT EXISTS team_form_games (
  sport TEXT NOT NULL,
  game_id TEXT NOT NULL,
  date TEXT,
  PRIMARY KEY (sport, game_id)
);

CREATE TABLE IF NOT EXISTS daily_reports (
  date TEXT NOT NULL,
  sport TEXT NOT NULL,
  body TEXT NOT NULL,
  metrics_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (date, sport)
);

CREATE TABLE IF NOT EXISTS strategies (
  id TEXT PRIMARY KEY,
  name TEXT,
  version INTEGER,
  rules_json TEXT,
  notes TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS strategy_tickets (
  id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  role TEXT NOT NULL,
  sport TEXT,
  date TEXT,
  game_id TEXT,
  matchup TEXT,
  market TEXT,
  side TEXT,
  pick TEXT,
  line REAL,
  ev REAL,
  edge REAL,
  tag TEXT,
  pin_vig REAL,
  pin_price REAL,
  model_version TEXT,
  checkpoint TEXT,
  data_quality INTEGER,
  result TEXT,
  profit REAL,
  clv REAL,
  traits_json TEXT,
  created_at TEXT,
  graded_at TEXT,
  qualified_at TEXT,
  execution_line REAL,
  execution_price REAL,
  benchmark_line REAL,
  benchmark_price REAL,
  entry_no_vig REAL,
  closing_line REAL,
  closing_price REAL,
  closing_no_vig REAL,
  stake REAL,
  missing_execution_price INTEGER
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  trigger_type TEXT,
  started_at TEXT,
  completed_at TEXT,
  status TEXT,
  sport TEXT,
  dates_json TEXT,
  games_discovered INTEGER,
  writes_attempted INTEGER,
  writes_succeeded INTEGER,
  writes_failed INTEGER,
  finals_discovered INTEGER,
  finals_graded INTEGER,
  error_summary TEXT,
  deployment_commit TEXT,
  model_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_predictions_sport_date ON predictions (sport, date);
CREATE INDEX IF NOT EXISTS idx_snap_sport_date ON prediction_snapshots (sport, date);
CREATE INDEX IF NOT EXISTS idx_snap_game ON prediction_snapshots (game_id, date);
CREATE INDEX IF NOT EXISTS idx_odds_game_time ON odds_snapshots (game_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_job_runs_type_time ON job_runs (job_type, started_at);
CREATE INDEX IF NOT EXISTS idx_strategy_tickets_role ON strategy_tickets (strategy_id, role, date);
