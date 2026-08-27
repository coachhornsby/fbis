-- Heritage executed bets: operator-imported execution-book wagers.
-- Separate from forecasts, qualified recs, FBIS-HC-v1, and the 7–0 seed.
-- Unique (execution_book, external_ticket_id). Identical re-import is idempotent.

CREATE TABLE IF NOT EXISTS executed_bets (
  id TEXT PRIMARY KEY,
  external_ticket_id TEXT NOT NULL,
  execution_book TEXT NOT NULL DEFAULT 'Heritage',
  executed_at TEXT,
  timezone TEXT,
  sport TEXT,
  date TEXT,
  game_id TEXT,
  source_event_id TEXT,
  source_url TEXT,
  matchup_text TEXT,
  away_team TEXT,
  home_team TEXT,
  market TEXT,
  period TEXT,
  selected_side TEXT,
  selected_team TEXT,
  execution_line REAL,
  execution_price REAL,
  risk_amount REAL,
  to_win_amount REAL,
  potential_payout REAL,
  currency TEXT DEFAULT 'USD',
  imported_at TEXT NOT NULL,
  import_source TEXT,
  raw_text_hash TEXT,
  raw_text TEXT,
  match_status TEXT,
  match_confidence TEXT,
  matched_prediction_id TEXT,
  matched_strategy_ticket_id TEXT,
  recommendation_status TEXT,
  model_version_at_entry TEXT,
  checkpoint_at_entry TEXT,
  result TEXT DEFAULT 'OPEN',
  settled_return REAL,
  profit REAL,
  graded_at TEXT,
  void_reason TEXT,
  heritage_current_line REAL,
  heritage_current_price REAL,
  heritage_current_at TEXT,
  pin_entry_line REAL,
  pin_entry_price REAL,
  pin_entry_no_vig REAL,
  pin_close_line REAL,
  pin_close_price REAL,
  pin_close_no_vig REAL,
  clv REAL,
  clv_status TEXT,
  clv_method_version TEXT,
  attribution_label TEXT,
  UNIQUE (execution_book, external_ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_executed_bets_date ON executed_bets (date, sport);
CREATE INDEX IF NOT EXISTS idx_executed_bets_game ON executed_bets (game_id);
CREATE INDEX IF NOT EXISTS idx_executed_bets_result ON executed_bets (result);

CREATE TABLE IF NOT EXISTS executed_bet_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bet_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_executed_bet_audit_bet ON executed_bet_audit (bet_id, created_at);
