-- KBO/NPB Phase 4B durable enrichment foundation.
-- Research-only infrastructure. No model-input activation, qualification, or wager authority.

CREATE TABLE IF NOT EXISTS asian_baseball_game_provider_crosswalk (
  id TEXT PRIMARY KEY,
  league TEXT NOT NULL CHECK(league IN ('KBO','NPB')),
  canonical_game_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_game_id TEXT NOT NULL,
  game_date TEXT NOT NULL,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  provider_home_team TEXT,
  provider_away_team TEXT,
  stadium TEXT,
  scheduled_start TEXT,
  match_method TEXT NOT NULL,
  match_confidence REAL NOT NULL DEFAULT 0,
  source_contract TEXT NOT NULL,
  source_ref TEXT,
  parser_version TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1 CHECK(research_only=1),
  can_influence_projection INTEGER NOT NULL DEFAULT 0 CHECK(can_influence_projection=0),
  can_qualify INTEGER NOT NULL DEFAULT 0 CHECK(can_qualify=0),
  can_authorize INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(canonical_game_id) REFERENCES asian_baseball_games(canonical_game_id),
  UNIQUE(league,provider,provider_game_id),
  UNIQUE(league,provider,canonical_game_id)
);
CREATE INDEX IF NOT EXISTS idx_ab_game_xwalk_date
  ON asian_baseball_game_provider_crosswalk(league,provider,game_date);
CREATE INDEX IF NOT EXISTS idx_ab_game_xwalk_canonical
  ON asian_baseball_game_provider_crosswalk(canonical_game_id,provider);

CREATE TABLE IF NOT EXISTS asian_baseball_player_identities (
  id TEXT PRIMARY KEY,
  league TEXT NOT NULL CHECK(league IN ('KBO','NPB')),
  fbis_player_id TEXT,
  provider TEXT NOT NULL,
  provider_player_id TEXT NOT NULL,
  observed_name TEXT,
  team_id TEXT,
  first_observed_date TEXT,
  last_observed_date TEXT,
  match_method TEXT NOT NULL,
  match_confidence REAL NOT NULL DEFAULT 0,
  ambiguity_state TEXT NOT NULL DEFAULT 'UNRESOLVED'
    CHECK(ambiguity_state IN ('RESOLVED','UNRESOLVED','AMBIGUOUS','CONFLICT')),
  source_contract TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1 CHECK(research_only=1),
  can_influence_projection INTEGER NOT NULL DEFAULT 0 CHECK(can_influence_projection=0),
  can_qualify INTEGER NOT NULL DEFAULT 0 CHECK(can_qualify=0),
  can_authorize INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(league,provider,provider_player_id)
);
CREATE INDEX IF NOT EXISTS idx_ab_player_identity_fbis
  ON asian_baseball_player_identities(league,fbis_player_id);
CREATE INDEX IF NOT EXISTS idx_ab_player_identity_name
  ON asian_baseball_player_identities(league,observed_name,team_id);

CREATE TABLE IF NOT EXISTS asian_baseball_player_game_observations (
  id TEXT PRIMARY KEY,
  league TEXT NOT NULL CHECK(league IN ('KBO','NPB')),
  canonical_game_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_game_id TEXT,
  provider_player_id TEXT NOT NULL,
  team_id TEXT,
  opponent_team_id TEXT,
  game_date TEXT NOT NULL,
  scheduled_start TEXT,
  completed_at TEXT,
  observation_role TEXT NOT NULL
    CHECK(observation_role IN ('STARTER','RELIEVER','HITTER','FIELDER','RUNNER','UNKNOWN')),
  batting_order INTEGER,
  position_text TEXT,
  innings_outs INTEGER,
  batters_faced INTEGER,
  pitches INTEGER,
  hits_allowed INTEGER,
  home_runs_allowed INTEGER,
  walks INTEGER,
  strikeouts INTEGER,
  runs_allowed INTEGER,
  earned_runs INTEGER,
  plate_appearances INTEGER,
  at_bats INTEGER,
  hits INTEGER,
  home_runs INTEGER,
  source_contract TEXT NOT NULL,
  source_ref TEXT,
  parser_version TEXT NOT NULL,
  represented_at TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  temporal_class TEXT NOT NULL DEFAULT 'POSTGAME'
    CHECK(temporal_class IN ('POSTGAME','PRE_GAME_PROVEN','UNKNOWN')),
  pregame_eligible INTEGER NOT NULL DEFAULT 0 CHECK(pregame_eligible IN (0,1)),
  provenance_json TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1 CHECK(research_only=1),
  can_influence_projection INTEGER NOT NULL DEFAULT 0 CHECK(can_influence_projection=0),
  can_qualify INTEGER NOT NULL DEFAULT 0 CHECK(can_qualify=0),
  can_authorize INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(canonical_game_id) REFERENCES asian_baseball_games(canonical_game_id),
  UNIQUE(league,provider,canonical_game_id,provider_player_id,observation_role)
);
CREATE INDEX IF NOT EXISTS idx_ab_player_game_player_time
  ON asian_baseball_player_game_observations(league,provider_player_id,game_date,scheduled_start);
CREATE INDEX IF NOT EXISTS idx_ab_player_game_team_time
  ON asian_baseball_player_game_observations(league,team_id,game_date,scheduled_start);
CREATE INDEX IF NOT EXISTS idx_ab_player_game_game
  ON asian_baseball_player_game_observations(canonical_game_id);

CREATE TABLE IF NOT EXISTS asian_baseball_enrichment_shards (
  id TEXT PRIMARY KEY,
  league TEXT NOT NULL CHECK(league IN ('KBO','NPB')),
  provider TEXT NOT NULL,
  season INTEGER NOT NULL,
  provider_player_id TEXT,
  data_family TEXT NOT NULL,
  cursor TEXT,
  max_requests INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','RUNNING','PARTIAL','DONE','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  requests_used INTEGER NOT NULL DEFAULT 0,
  rows_discovered INTEGER NOT NULL DEFAULT 0,
  rows_persisted INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  malformed_rows INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  last_error TEXT,
  source_contract TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1 CHECK(research_only=1),
  can_influence_projection INTEGER NOT NULL DEFAULT 0 CHECK(can_influence_projection=0),
  can_qualify INTEGER NOT NULL DEFAULT 0 CHECK(can_qualify=0),
  can_authorize INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(league,provider,season,provider_player_id,data_family)
);
CREATE INDEX IF NOT EXISTS idx_ab_enrichment_shards_status
  ON asian_baseball_enrichment_shards(league,provider,status,season);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0090_asian_baseball_enrichment_foundation',datetime('now'));
