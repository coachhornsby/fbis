-- Additive MLB evidence only. Does not change sport ownership or model permissions.
CREATE TABLE IF NOT EXISTS mlb_intelligence_game_versions (
 game_id TEXT NOT NULL, source_hash TEXT NOT NULL, season INTEGER NOT NULL,
 game_type TEXT NOT NULL, official_date TEXT NOT NULL, start_time TEXT NOT NULL,
 observed_at TEXT NOT NULL, raw_r2_key TEXT NOT NULL, normalized_r2_key TEXT NOT NULL,
 player_records INTEGER NOT NULL, pitch_records INTEGER NOT NULL,
 PRIMARY KEY(game_id,source_hash)
);
CREATE INDEX IF NOT EXISTS idx_mlb_intelligence_date ON mlb_intelligence_game_versions(official_date,game_type);
CREATE TABLE IF NOT EXISTS mlb_player_game_records (
 player_id TEXT NOT NULL, game_id TEXT NOT NULL, stat_group TEXT NOT NULL,
 source_hash TEXT NOT NULL, team_id TEXT NOT NULL, opponent_id TEXT NOT NULL,
 is_home INTEGER NOT NULL, official_date TEXT NOT NULL, game_type TEXT NOT NULL,
 observed_at TEXT NOT NULL, stats_json TEXT NOT NULL,
 PRIMARY KEY(player_id,game_id,stat_group,source_hash)
);
CREATE INDEX IF NOT EXISTS idx_mlb_player_game_recent ON mlb_player_game_records(player_id,official_date DESC,observed_at DESC);
CREATE TABLE IF NOT EXISTS mlb_roster_membership_observations (
 player_id TEXT NOT NULL, team_id TEXT NOT NULL, effective_date TEXT NOT NULL,
 game_id TEXT NOT NULL, observed_at TEXT NOT NULL, source_hash TEXT NOT NULL,
 basis TEXT NOT NULL DEFAULT 'OFFICIAL_GAME_APPEARANCE',
 PRIMARY KEY(player_id,team_id,game_id,source_hash)
);
CREATE TABLE IF NOT EXISTS mlb_intelligence_ingestion_receipts (
 game_id TEXT NOT NULL, source_hash TEXT NOT NULL, imported_at TEXT NOT NULL,
 receipt_json TEXT NOT NULL, PRIMARY KEY(game_id,source_hash)
);
INSERT OR IGNORE INTO schema_migrations(id,applied_at) VALUES('0124_mlb_player_intelligence',datetime('now'));
