CREATE TABLE IF NOT EXISTS manual_score_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sport TEXT NOT NULL,
  game_id TEXT NOT NULL,
  home_score INTEGER NOT NULL,
  away_score INTEGER NOT NULL,
  affected_strategy INTEGER NOT NULL DEFAULT 0,
  affected_bets INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_manual_score_audit_game ON manual_score_audit(sport, game_id, created_at);
