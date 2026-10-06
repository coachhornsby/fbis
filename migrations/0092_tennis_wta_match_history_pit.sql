-- Canonical WTA official match-history + PIT state foundation.
CREATE TABLE IF NOT EXISTS tennis_official_matches (
  match_id TEXT PRIMARY KEY,
  tour TEXT NOT NULL,
  source TEXT NOT NULL,
  source_match_id TEXT NOT NULL,
  tournament_group_id TEXT,
  tournament_year INTEGER,
  tournament_name TEXT,
  tournament_level TEXT,
  round_code TEXT,
  match_time TEXT,
  surface TEXT,
  indoor_outdoor TEXT,
  venue TEXT,
  player1_id TEXT,
  player2_id TEXT,
  source_player1_id TEXT,
  source_player2_id TEXT,
  source_player1_partner_id TEXT,
  source_player2_partner_id TEXT,
  winner_id TEXT,
  source_winner_id TEXT,
  score_text TEXT,
  sets_json TEXT,
  player1_games INTEGER,
  player2_games INTEGER,
  player1_sets INTEGER,
  player2_sets INTEGER,
  duration_seconds INTEGER,
  player1_entry_rank INTEGER,
  player2_entry_rank INTEGER,
  completion_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  result_reason TEXT,
  observed_at TEXT NOT NULL,
  effective_at TEXT,
  ingested_at TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  raw_artifact_key TEXT,
  UNIQUE(source,tour,source_match_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_official_matches_p1_time ON tennis_official_matches(tour,player1_id,match_time);
CREATE INDEX IF NOT EXISTS idx_tennis_official_matches_p2_time ON tennis_official_matches(tour,player2_id,match_time);
CREATE INDEX IF NOT EXISTS idx_tennis_official_matches_tournament ON tennis_official_matches(tour,tournament_year,tournament_group_id);
CREATE INDEX IF NOT EXISTS idx_tennis_official_matches_surface_time ON tennis_official_matches(tour,surface,match_time);

CREATE TABLE IF NOT EXISTS tennis_match_identity_review_queue (
  review_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  tour TEXT NOT NULL,
  source_match_id TEXT,
  source_player_id TEXT,
  raw_name TEXT,
  reason TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tennis_match_identity_review_open ON tennis_match_identity_review_queue(tour,status,created_at);

CREATE TABLE IF NOT EXISTS tennis_wta_shards (
  shard_key TEXT PRIMARY KEY,
  stream TEXT NOT NULL,
  year INTEGER,
  tournament_group_id TEXT,
  status TEXT NOT NULL,
  source_path TEXT,
  cursor_value TEXT,
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_written INTEGER NOT NULL DEFAULT 0,
  unresolved_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  checksum TEXT,
  raw_artifact_key TEXT,
  last_error TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tennis_wta_shards_stream_status ON tennis_wta_shards(stream,status,year);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0092_tennis_wta_match_history_pit',datetime('now'));
