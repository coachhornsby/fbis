-- CFB persistent individual/team statistics: REVIEW CANDIDATE ONLY.
-- Not a production migration. Move into the numbered migration stream only AFTER
-- draft college-persistence recovery PR #927 (0098) is independently qualified.
-- Keep all state research-only, immutable by content-hash, and PIT provenance explicit.
CREATE TABLE IF NOT EXISTS cfb_team_game_stat_observations (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  opponent TEXT,
  game_at TEXT NOT NULL,
  source TEXT NOT NULL,
  source_timestamp TEXT,
  observed_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  temporal_class TEXT NOT NULL DEFAULT 'POSTGAME_RESEARCH',
  metrics_json TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  UNIQUE(team_id,game_id,source,content_hash)
);
CREATE INDEX IF NOT EXISTS idx_cfb_team_game_stats_team
  ON cfb_team_game_stat_observations(team_id,season,game_at DESC);

CREATE TABLE IF NOT EXISTS cfb_team_season_stat_snapshots (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_timestamp TEXT,
  observed_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  source_game_ids_json TEXT,
  ingestion_version TEXT,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  UNIQUE(team_id,season,source,content_hash)
);
CREATE INDEX IF NOT EXISTS idx_cfb_team_season_stats
  ON cfb_team_season_stat_snapshots(team_id,season,observed_at DESC);

CREATE TABLE IF NOT EXISTS cfb_player_game_stat_observations (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  opponent TEXT,
  game_at TEXT NOT NULL,
  source TEXT NOT NULL,
  source_timestamp TEXT,
  observed_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  temporal_class TEXT NOT NULL DEFAULT 'POSTGAME_RESEARCH',
  metrics_json TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  UNIQUE(team_id,player_id,game_id,source,content_hash)
);
CREATE INDEX IF NOT EXISTS idx_cfb_player_game_stats_player
  ON cfb_player_game_stat_observations(team_id,season,player_id,game_at DESC);

CREATE TABLE IF NOT EXISTS cfb_player_season_stat_snapshots (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_timestamp TEXT,
  observed_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  source_game_ids_json TEXT,
  ingestion_version TEXT,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  UNIQUE(team_id,player_id,season,source,content_hash)
);
CREATE INDEX IF NOT EXISTS idx_cfb_player_season_stats
  ON cfb_player_season_stat_snapshots(team_id,season,player_id,observed_at DESC);

-- No source collector, model weight, role authority, betting permission, or
-- schema_migrations write is authorized by this candidate alone.
