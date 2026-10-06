-- Persistent FBIS tennis player bank + matchup history.
-- Research-only. Historical observations are immutable; current bank is a materialized state.

CREATE TABLE IF NOT EXISTS tennis_player_bank (
  tour TEXT NOT NULL,
  player_key TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  country TEXT,
  handedness TEXT,
  birth_date TEXT,
  headshot_url TEXT,
  current_rank INTEGER,
  ranking_points INTEGER,
  profile_json TEXT NOT NULL,
  recent_form_json TEXT,
  source TEXT NOT NULL,
  source_as_of TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tour, player_key)
);
CREATE INDEX IF NOT EXISTS idx_tennis_player_bank_rank ON tennis_player_bank(tour,current_rank);
CREATE INDEX IF NOT EXISTS idx_tennis_player_bank_id ON tennis_player_bank(player_id);

CREATE TABLE IF NOT EXISTS tennis_match_history (
  match_key TEXT PRIMARY KEY,
  tour TEXT NOT NULL,
  match_date TEXT NOT NULL,
  tournament TEXT,
  surface TEXT,
  round TEXT,
  player1_key TEXT NOT NULL,
  player1_name TEXT NOT NULL,
  player2_key TEXT NOT NULL,
  player2_name TEXT NOT NULL,
  winner_key TEXT,
  score TEXT,
  player1_rank INTEGER,
  player2_rank INTEGER,
  player1_stats_json TEXT,
  player2_stats_json TEXT,
  source TEXT NOT NULL,
  source_as_of TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tennis_history_p1 ON tennis_match_history(tour,player1_key,match_date DESC);
CREATE INDEX IF NOT EXISTS idx_tennis_history_p2 ON tennis_match_history(tour,player2_key,match_date DESC);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0053_tennis_player_bank', datetime('now'));
