-- Nonproduction operational pilot. NOT numbered; NOT approved for production.
CREATE TABLE IF NOT EXISTS cfb_postgame_jobs (
 game_id TEXT PRIMARY KEY, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 last_error TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cfb_postgame_game_versions (
 id TEXT PRIMARY KEY, game_id TEXT NOT NULL, season INTEGER NOT NULL,
 observed_at TEXT NOT NULL, committed_at TEXT NOT NULL, raw_key TEXT NOT NULL,
 raw_hash TEXT NOT NULL, body_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cfb_postgame_version_game
 ON cfb_postgame_game_versions(game_id,observed_at);
CREATE INDEX IF NOT EXISTS idx_cfb_postgame_version_season ON cfb_postgame_game_versions(season,observed_at);
CREATE TABLE IF NOT EXISTS cfb_postgame_game_current (
 game_id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES cfb_postgame_game_versions(id)
);
CREATE TABLE IF NOT EXISTS cfb_postgame_card_versions (
 id TEXT PRIMARY KEY, team_id TEXT NOT NULL, season INTEGER NOT NULL,
 published_at TEXT NOT NULL, body_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cfb_postgame_card_current (
 team_id TEXT NOT NULL, season INTEGER NOT NULL,
 version_id TEXT NOT NULL REFERENCES cfb_postgame_card_versions(id),PRIMARY KEY(team_id,season)
);
CREATE TABLE IF NOT EXISTS cfb_postgame_outbox (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, version_id TEXT NOT NULL,
 body_json TEXT NOT NULL, completed_at TEXT
);
