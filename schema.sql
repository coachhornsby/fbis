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
  model_version TEXT,
  as_of TEXT NOT NULL,
  proj_home REAL,
  proj_away REAL,
  proj_total REAL,
  proj_margin REAL,
  p_home_final REAL,
  p_away_final REAL,
  p_market REAL,
  p_espn REAL,
  p_score REAL,
  p_form REAL,
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

CREATE TABLE IF NOT EXISTS bet_candidates (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  sport TEXT,
  market TEXT,
  side TEXT,
  qualified INTEGER,
  ev REAL,
  edge REAL,
  pin_price REAL,
  decision TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bets (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  sport TEXT,
  market TEXT,
  side TEXT,
  execution_book TEXT,
  execution_price REAL,
  execution_line REAL,
  pin_price REAL,
  entry_no_vig REAL,
  stake REAL,
  placed_at TEXT,
  result TEXT,
  profit REAL,
  clv REAL
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  date TEXT NOT NULL,
  sport TEXT NOT NULL,
  model_version TEXT,
  n INTEGER,
  brier REAL,
  log_loss REAL,
  mae_total REAL,
  PRIMARY KEY (date, sport, model_version)
);

CREATE INDEX IF NOT EXISTS idx_predictions_sport_date ON predictions (sport, date);
CREATE INDEX IF NOT EXISTS idx_odds_game_time ON odds_snapshots (game_id, captured_at);
