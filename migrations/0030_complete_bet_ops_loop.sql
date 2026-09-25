-- Complete executed-wager operations loop: parent entries, legs, advisor freeze, exceptions.
ALTER TABLE executed_bets ADD COLUMN entry_id TEXT;
ALTER TABLE executed_bets ADD COLUMN leg_index INTEGER;
ALTER TABLE executed_bets ADD COLUMN leg_count INTEGER;
ALTER TABLE executed_bets ADD COLUMN leg_result TEXT;
ALTER TABLE executed_bets ADD COLUMN advisor_decision TEXT;
ALTER TABLE executed_bets ADD COLUMN advisor_confidence TEXT;
ALTER TABLE executed_bets ADD COLUMN advisor_reason TEXT;
ALTER TABLE executed_bets ADD COLUMN advisor_reviewed_at TEXT;
ALTER TABLE executed_bets ADD COLUMN advisor_snapshot_hash TEXT;
ALTER TABLE executed_bets ADD COLUMN exception_code TEXT;

CREATE TABLE IF NOT EXISTS executed_bet_entries (
  id TEXT PRIMARY KEY,
  execution_book TEXT NOT NULL,
  entry_type TEXT,
  executed_at TEXT,
  sport TEXT,
  risk_amount REAL,
  to_win_amount REAL,
  potential_payout REAL,
  result TEXT NOT NULL DEFAULT 'OPEN',
  settled_return REAL,
  profit REAL,
  leg_count INTEGER NOT NULL DEFAULT 1,
  legs_won INTEGER NOT NULL DEFAULT 0,
  legs_lost INTEGER NOT NULL DEFAULT 0,
  legs_push INTEGER NOT NULL DEFAULT 0,
  graded_at TEXT,
  funding_type TEXT NOT NULL DEFAULT 'CASH',
  source_ticket_id TEXT,
  tracker_metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_executed_bet_entries_book_time ON executed_bet_entries(execution_book, executed_at);
CREATE INDEX IF NOT EXISTS idx_executed_bets_entry_id ON executed_bets(entry_id);
CREATE INDEX IF NOT EXISTS idx_executed_bets_exception_code ON executed_bets(exception_code);

CREATE TABLE IF NOT EXISTS advisor_reviews (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  date TEXT NOT NULL,
  decision TEXT NOT NULL,
  confidence TEXT,
  reason TEXT,
  model_version TEXT,
  snapshot_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'openai',
  model TEXT,
  UNIQUE(game_id, snapshot_hash)
);
CREATE INDEX IF NOT EXISTS idx_advisor_reviews_date_sport ON advisor_reviews(date, sport);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0030_complete_bet_ops_loop', datetime('now'));
