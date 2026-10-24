-- Free current-season ATP/WTA third-party RESEARCH statistics. Not official settlement.
-- Event date from source may be tournament week, not match start: never use as
-- as-of evidence. source_observed_at is the earliest FBIS knowledge timestamp.
CREATE TABLE IF NOT EXISTS tennis_free_current_matches (
 source_event_key TEXT PRIMARY KEY,
 provider TEXT NOT NULL CHECK(provider='TENNISMYLIFE'),
 tour TEXT NOT NULL CHECK(tour IN ('atp','wta')),
 source_date_label TEXT NOT NULL,
 tournament_id TEXT NOT NULL,
 match_num TEXT NOT NULL,
 winner_source_id TEXT NOT NULL,
 loser_source_id TEXT NOT NULL,
 winner_name TEXT,
 loser_name TEXT,
 surface TEXT,
 result_score TEXT NOT NULL,
 winner_stats_json TEXT NOT NULL,
 loser_stats_json TEXT NOT NULL,
 source_row_checksum TEXT NOT NULL,
 raw_file_checksum TEXT NOT NULL,
 raw_r2_key TEXT NOT NULL,
 first_observed_at TEXT NOT NULL,
 last_observed_at TEXT NOT NULL,
 contract_trading_authorized INTEGER NOT NULL DEFAULT 0 CHECK(contract_trading_authorized=0),
 UNIQUE(tour,tournament_id,match_num)
);
CREATE INDEX IF NOT EXISTS idx_tennis_free_win ON tennis_free_current_matches(tour,winner_source_id,source_date_label);
CREATE INDEX IF NOT EXISTS idx_tennis_free_lose ON tennis_free_current_matches(tour,loser_source_id,source_date_label);
CREATE INDEX IF NOT EXISTS idx_tennis_free_obs ON tennis_free_current_matches(tour,last_observed_at);
CREATE TABLE IF NOT EXISTS tennis_free_current_observations (
 observation_key TEXT PRIMARY KEY,
 source_event_key TEXT NOT NULL,
 source_row_checksum TEXT NOT NULL,
 raw_file_checksum TEXT NOT NULL,
 raw_r2_key TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 parsed_json TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider='TENNISMYLIFE'),
 contract_trading_authorized INTEGER NOT NULL DEFAULT 0 CHECK(contract_trading_authorized=0),
 UNIQUE(source_event_key,source_row_checksum)
);
CREATE INDEX IF NOT EXISTS idx_tennis_free_obs_row ON tennis_free_current_observations(source_event_key,observed_at);
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
 VALUES('0125_tennis_free_current_research',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
