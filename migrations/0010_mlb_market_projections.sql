-- Immutable Pal F5/team-total/player-prop research rows.
-- Projections are source data only; no row is an executable offer without a matched book quote.
CREATE TABLE IF NOT EXISTS mlb_market_projections (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  date TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  period TEXT NOT NULL,
  market_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  subject_name TEXT,
  team_id TEXT,
  opponent_id TEXT,
  line REAL,
  p_over REAL,
  p_under REAL,
  average REAL,
  projected_home REAL,
  projected_away REAL,
  p_home REAL,
  p_away REAL,
  source TEXT NOT NULL,
  source_market_key TEXT,
  source_market_name TEXT,
  source_as_of TEXT,
  source_request_id TEXT,
  model_version TEXT,
  lineups_official INTEGER,
  frozen_at TEXT NOT NULL,
  book TEXT,
  book_line REAL,
  book_over_price REAL,
  book_under_price REAL,
  priced INTEGER NOT NULL DEFAULT 0,
  qualification_state TEXT NOT NULL DEFAULT 'PROP_WATCH',
  qualification_reason TEXT,
  actual_value REAL,
  result TEXT,
  graded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mlb_market_proj_game ON mlb_market_projections (game_id, date, checkpoint);
CREATE INDEX IF NOT EXISTS idx_mlb_market_proj_subject ON mlb_market_projections (subject_id, market_type, date);
CREATE INDEX IF NOT EXISTS idx_mlb_market_proj_market ON mlb_market_projections (period, market_type, date);
