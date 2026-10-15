-- 0105: licensed Tier 3 weekly CFBD training snapshots.
-- RAW premium dataset is stored only in private R2/D1, never in the public Git repo.
-- No projection / wager authority is derived from import.
CREATE TABLE IF NOT EXISTS cfb_tier3_training_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  source_sha256 TEXT NOT NULL UNIQUE,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  source_name TEXT NOT NULL DEFAULT 'cfbd-tier3-weekly',
  source_filename TEXT NOT NULL,
  received_at TEXT NOT NULL,
  provider_published_at TEXT,
  raw_r2_key TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  feature_count INTEGER NOT NULL,
  schema_columns_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'research_only' CHECK(status='research_only'),
  can_influence_projection INTEGER NOT NULL DEFAULT 0 CHECK(can_influence_projection=0),
  can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0)
);
CREATE TABLE IF NOT EXISTS cfb_tier3_training_games (
  snapshot_id TEXT NOT NULL REFERENCES cfb_tier3_training_snapshots(snapshot_id),
  game_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  kickoff_literal TEXT NOT NULL,
  home_team_source TEXT NOT NULL,
  away_team_source TEXT NOT NULL,
  home_conference_source TEXT,
  away_conference_source TEXT,
  neutral_site INTEGER NOT NULL DEFAULT 0,
  opening_spread REAL,
  features_json TEXT NOT NULL,
  row_sha256 TEXT NOT NULL,
  identity_status TEXT NOT NULL DEFAULT 'pending_canonical_match',
  point_in_time_status TEXT NOT NULL DEFAULT 'source_feature_cutoff_unverified',
  authority TEXT NOT NULL DEFAULT 'research_only' CHECK(authority='research_only'),
  PRIMARY KEY(snapshot_id,game_id)
);
CREATE INDEX IF NOT EXISTS idx_cfb_tier3_games_week ON cfb_tier3_training_games(season,week,game_id);
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES ('0105_cfb_tier3_training_research',datetime('now'));
