-- CFB persistent directory Phase B: canonical players and temporal rosters.
-- FBIS-STATE-OVERLAY-v1. Identity/state infrastructure only; no projection, qualification, or wager authority.

CREATE TABLE IF NOT EXISTS cfb_canonical_players (
  player_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  current_position TEXT,
  active INTEGER,
  identity_status TEXT NOT NULL DEFAULT 'RESOLVED',
  identity_confidence REAL,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  source_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cfb_canonical_players_name
  ON cfb_canonical_players(canonical_name,active);
CREATE INDEX IF NOT EXISTS idx_cfb_canonical_players_identity
  ON cfb_canonical_players(identity_status,identity_confidence);

CREATE TABLE IF NOT EXISTS cfb_player_provider_ids (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_player_id TEXT NOT NULL,
  provider_name TEXT,
  effective_from TEXT,
  effective_to TEXT,
  observed_at TEXT NOT NULL,
  confidence REAL,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider,provider_player_id,effective_from)
);
CREATE INDEX IF NOT EXISTS idx_cfb_player_provider_lookup
  ON cfb_player_provider_ids(provider,provider_player_id,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_cfb_player_provider_player
  ON cfb_player_provider_ids(player_id,provider);

CREATE TABLE IF NOT EXISTS cfb_player_aliases (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_type TEXT NOT NULL DEFAULT 'NAME',
  source TEXT NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  observed_at TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL,
  UNIQUE(player_id,normalized_alias,source,effective_from)
);
CREATE INDEX IF NOT EXISTS idx_cfb_player_alias_lookup
  ON cfb_player_aliases(normalized_alias,effective_from,effective_to);

CREATE TABLE IF NOT EXISTS cfb_roster_membership (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  team_id TEXT,
  provider_team_id TEXT,
  season INTEGER NOT NULL,
  position TEXT,
  position_abbreviation TEXT,
  jersey TEXT,
  class_year TEXT,
  height REAL,
  weight REAL,
  first_game_id TEXT,
  first_week INTEGER,
  last_game_id TEXT,
  last_week INTEGER,
  games_rostered INTEGER,
  effective_from TEXT NOT NULL,
  effective_to TEXT NOT NULL,
  source TEXT NOT NULL,
  source_timestamp TEXT,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  confidence REAL,
  raw_json TEXT,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  UNIQUE(player_id,team_id,season,source)
);
CREATE INDEX IF NOT EXISTS idx_cfb_roster_team_pit
  ON cfb_roster_membership(team_id,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_cfb_roster_player_pit
  ON cfb_roster_membership(player_id,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_cfb_roster_season_team
  ON cfb_roster_membership(season,team_id);

CREATE TABLE IF NOT EXISTS cfb_roster_observations (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  team_id TEXT,
  provider TEXT NOT NULL,
  provider_player_id TEXT,
  provider_team_id TEXT,
  season INTEGER NOT NULL,
  position TEXT,
  jersey TEXT,
  class_year TEXT,
  first_game_id TEXT,
  first_week INTEGER,
  last_game_id TEXT,
  last_week INTEGER,
  games_rostered INTEGER,
  payload_json TEXT NOT NULL,
  source_timestamp TEXT,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  confidence REAL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  UNIQUE(provider,provider_player_id,provider_team_id,season,content_hash)
);
CREATE INDEX IF NOT EXISTS idx_cfb_roster_obs_player_time
  ON cfb_roster_observations(player_id,season,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cfb_roster_obs_team_time
  ON cfb_roster_observations(team_id,season,observed_at DESC);

CREATE TABLE IF NOT EXISTS cfb_roster_source_coverage (
  season INTEGER NOT NULL,
  source TEXT NOT NULL,
  roster_rows INTEGER NOT NULL DEFAULT 0,
  distinct_players INTEGER NOT NULL DEFAULT 0,
  distinct_teams INTEGER NOT NULL DEFAULT 0,
  resolved_team_rows INTEGER NOT NULL DEFAULT 0,
  orphan_team_rows INTEGER NOT NULL DEFAULT 0,
  provisional_players INTEGER NOT NULL DEFAULT 0,
  game_roster_rows INTEGER,
  source_file TEXT,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(season,source)
);

INSERT OR IGNORE INTO cfb_state_overlay_governance
(state_family,overlay_version,mode,can_influence_projection,can_qualify,can_authorize_wager,notes,updated_at)
VALUES
('PLAYER_DIRECTORY','FBIS-STATE-OVERLAY-v1','ACTIVE_INFRASTRUCTURE',0,0,0,'Canonical CFB player identity only; no projection weight.',datetime('now')),
('ROSTER_STATE','FBIS-STATE-OVERLAY-v1','RESEARCH',0,0,0,'Temporal CFB roster state; no projection, qualification, or wager authority.',datetime('now'));

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0075_cfb_persistent_directory_phase_b',datetime('now'));
