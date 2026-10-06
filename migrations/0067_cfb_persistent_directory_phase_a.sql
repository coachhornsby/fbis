-- CFB persistent directory Phase A: canonical teams, aliases/provider IDs, temporal conference history.
-- FBIS-STATE-OVERLAY-v1. Infrastructure only: no projection weight, qualification, or wager authority.

CREATE TABLE IF NOT EXISTS cfb_canonical_teams (
  team_id TEXT PRIMARY KEY,
  school_name TEXT NOT NULL,
  athletic_name TEXT,
  abbreviation TEXT,
  subdivision TEXT NOT NULL DEFAULT 'UNKNOWN',
  current_conference TEXT,
  independent INTEGER NOT NULL DEFAULT 0,
  city TEXT,
  state TEXT,
  country TEXT DEFAULT 'USA',
  home_venue_id TEXT,
  home_stadium TEXT,
  latitude REAL,
  longitude REAL,
  timezone TEXT,
  elevation_feet REAL,
  active INTEGER NOT NULL DEFAULT 1,
  identity_confidence REAL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  source_json TEXT,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cfb_canonical_teams_subdivision
  ON cfb_canonical_teams(subdivision,active,current_conference);

CREATE TABLE IF NOT EXISTS cfb_team_aliases (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_type TEXT NOT NULL DEFAULT 'NAME',
  source TEXT NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  observed_at TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL,
  UNIQUE(team_id,normalized_alias,source,effective_from)
);
CREATE INDEX IF NOT EXISTS idx_cfb_team_alias_lookup
  ON cfb_team_aliases(normalized_alias,effective_from,effective_to);

CREATE TABLE IF NOT EXISTS cfb_team_provider_ids (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_team_id TEXT NOT NULL,
  provider_team_name TEXT,
  effective_from TEXT,
  effective_to TEXT,
  observed_at TEXT NOT NULL,
  confidence REAL,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider,provider_team_id,effective_from)
);
CREATE INDEX IF NOT EXISTS idx_cfb_team_provider_team
  ON cfb_team_provider_ids(team_id,provider,effective_from,effective_to);

CREATE TABLE IF NOT EXISTS cfb_conference_membership (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  conference_id TEXT,
  conference_name TEXT,
  subdivision TEXT,
  independent INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence REAL,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(team_id,effective_from,conference_name)
);
CREATE INDEX IF NOT EXISTS idx_cfb_conference_membership_pit
  ON cfb_conference_membership(team_id,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_cfb_conference_membership_conf
  ON cfb_conference_membership(conference_name,effective_from,effective_to);

CREATE TABLE IF NOT EXISTS cfb_team_identity_observations (
  id TEXT PRIMARY KEY,
  team_id TEXT,
  provider TEXT NOT NULL,
  provider_team_id TEXT,
  school_name TEXT NOT NULL,
  conference_name TEXT,
  subdivision TEXT,
  payload_json TEXT NOT NULL,
  source_timestamp TEXT,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  content_hash TEXT,
  supersedes_id TEXT,
  confidence REAL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cfb_team_identity_obs_team_time
  ON cfb_team_identity_observations(team_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS cfb_state_overlay_governance (
  state_family TEXT PRIMARY KEY,
  overlay_version TEXT NOT NULL DEFAULT 'FBIS-STATE-OVERLAY-v1',
  mode TEXT NOT NULL DEFAULT 'RESEARCH',
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO cfb_state_overlay_governance
(state_family,overlay_version,mode,can_influence_projection,can_qualify,can_authorize_wager,notes,updated_at)
VALUES
('TEAM_DIRECTORY','FBIS-STATE-OVERLAY-v1','ACTIVE_INFRASTRUCTURE',0,0,0,'Canonical CFB identity and temporal conference state; no projection weight.',datetime('now')),
('TEAM_STATE','FBIS-STATE-OVERLAY-v1','RESEARCH',0,0,0,'Persistent CFB state remains research/context-only until leakage-safe validation.',datetime('now'));

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0067_cfb_persistent_directory_phase_a',datetime('now'));
