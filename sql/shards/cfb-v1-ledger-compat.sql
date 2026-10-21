-- CFB-only sport ledger compatibility tables.
-- These must contain only sport='cfb' rows in CFB_DB.
-- Safe, additive, idempotent. Never removes or rewrites PRIMARY rows.
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, sport TEXT NOT NULL, date TEXT NOT NULL,
  matchup TEXT, checkpoint TEXT, model_version TEXT, as_of TEXT NOT NULL,
  proj_home REAL, proj_away REAL, proj_total REAL, proj_margin REAL,
  pal_home REAL, pal_away REAL, p_home_final REAL, p_away_final REAL,
  p_market REAL, p_espn REAL, p_score REAL, p_form REAL, p_pal REAL,
  weights_json TEXT, layers_json TEXT, pal_json TEXT, pal_as_of TEXT,
  lineups_official INTEGER, data_quality INTEGER, pin_home_ml REAL,
  pin_away_ml REAL, pin_vig REAL, engine TEXT, actual_home REAL,
  actual_away REAL, graded_at TEXT, projection_state TEXT,
  projection_kind TEXT, f5_actual_home REAL, f5_actual_away REAL
);
CREATE TABLE IF NOT EXISTS odds_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, sport TEXT NOT NULL,
  date TEXT, book TEXT, market TEXT, side TEXT, line REAL, price REAL,
  implied REAL, no_vig REAL, captured_at TEXT NOT NULL, period TEXT,
  event_id TEXT, game_start TEXT, checkpoint TEXT,
  rejected_post_start INTEGER DEFAULT 0, paired INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS team_form (
  sport TEXT NOT NULL, season INTEGER NOT NULL, team_key TEXT NOT NULL,
  games INTEGER, points_for REAL, points_against REAL, updated_at TEXT,
  PRIMARY KEY(sport, season, team_key)
);
CREATE INDEX IF NOT EXISTS idx_cfb_predictions_sport_date ON predictions(sport,date);
CREATE INDEX IF NOT EXISTS idx_cfb_odds_sport_date ON odds_snapshots(sport,date);

CREATE TABLE IF NOT EXISTS team_form_games (
  sport TEXT NOT NULL, game_id TEXT NOT NULL, date TEXT,
  PRIMARY KEY(sport, game_id)
);
