-- CBB persistent team/player directory Phase A.
-- FBIS-STATE-OVERLAY-v1 research infrastructure only.
-- No projection weight, qualification, totals activation, or wager authority.

CREATE TABLE IF NOT EXISTS cbb_canonical_teams (
  team_id TEXT PRIMARY KEY,
  espn_team_id TEXT,
  school_name TEXT NOT NULL,
  display_name TEXT,
  abbreviation TEXT,
  classification TEXT NOT NULL DEFAULT 'UNKNOWN',
  active INTEGER NOT NULL DEFAULT 1,
  current_conference TEXT,
  home_venue TEXT,
  hca_reference REAL,
  head_coach_name TEXT,
  coach_tenure_start TEXT,
  identity_confidence REAL,
  source_json TEXT,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cbb_team_espn ON cbb_canonical_teams(espn_team_id) WHERE espn_team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cbb_team_active ON cbb_canonical_teams(active,classification);

CREATE TABLE IF NOT EXISTS cbb_team_aliases (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source TEXT NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  observed_at TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL,
  UNIQUE(team_id,normalized_alias,source,effective_from)
);
CREATE INDEX IF NOT EXISTS idx_cbb_team_alias_lookup ON cbb_team_aliases(normalized_alias,effective_from,effective_to);

CREATE TABLE IF NOT EXISTS cbb_conference_membership (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  conference_name TEXT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence REAL,
  provenance_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_conf_pit ON cbb_conference_membership(team_id,effective_from,effective_to);

CREATE TABLE IF NOT EXISTS cbb_players (
  player_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  identity_status TEXT NOT NULL DEFAULT 'PROVISIONAL',
  provider_player_id TEXT,
  position TEXT,
  class_year TEXT,
  height_text TEXT,
  size_text TEXT,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  source_json TEXT,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_player_name ON cbb_players(canonical_name);

CREATE TABLE IF NOT EXISTS cbb_player_aliases (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL,
  UNIQUE(player_id,normalized_alias,source)
);
CREATE INDEX IF NOT EXISTS idx_cbb_player_alias_lookup ON cbb_player_aliases(normalized_alias);

CREATE TABLE IF NOT EXISTS cbb_roster_membership (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  season INTEGER,
  effective_from TEXT NOT NULL,
  effective_to TEXT NOT NULL,
  pit_resolvable INTEGER NOT NULL DEFAULT 1,
  membership_basis TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence REAL,
  provenance_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_roster_team_pit ON cbb_roster_membership(team_id,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_cbb_roster_player_pit ON cbb_roster_membership(player_id,effective_from,effective_to);

CREATE TABLE IF NOT EXISTS cbb_state_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  team_id TEXT,
  game_id TEXT,
  season INTEGER,
  state_family TEXT NOT NULL,
  state_value_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  source TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  confidence REAL,
  stale INTEGER NOT NULL DEFAULT 0,
  supersedes_id TEXT,
  pit_eligible INTEGER NOT NULL DEFAULT 1,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_state_entity_time ON cbb_state_events(entity_type,entity_id,effective_at);
CREATE INDEX IF NOT EXISTS idx_cbb_state_team_time ON cbb_state_events(team_id,effective_at);
CREATE INDEX IF NOT EXISTS idx_cbb_state_family_time ON cbb_state_events(state_family,effective_at);

CREATE TABLE IF NOT EXISTS cbb_team_state_snapshots (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  season INTEGER,
  as_of TEXT NOT NULL,
  last_verified_starting_lineup_json TEXT,
  expected_starting_lineup_json TEXT,
  lineup_continuity REAL,
  rotation_hierarchy_json TEXT,
  bench_hierarchy_json TEXT,
  schedule_state_json TEXT,
  availability_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  source TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  confidence REAL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_team_snapshot_time ON cbb_team_state_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS cbb_player_state_snapshots (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  team_id TEXT,
  season INTEGER,
  as_of TEXT NOT NULL,
  starter_role TEXT NOT NULL DEFAULT 'UNKNOWN',
  rotation_rank INTEGER,
  recent_minutes REAL,
  expected_minutes REAL,
  usage_role TEXT,
  availability_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  injury_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  replacement_json TEXT,
  source TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  confidence REAL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_player_snapshot_time ON cbb_player_state_snapshots(player_id,as_of DESC);
CREATE INDEX IF NOT EXISTS idx_cbb_player_snapshot_team ON cbb_player_state_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS cbb_schedule_items (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  opponent_team_id TEXT,
  season INTEGER NOT NULL,
  game_date TEXT NOT NULL,
  home_away TEXT NOT NULL,
  rest_days REAL,
  travel_miles REAL,
  fixture_congestion_json TEXT,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_schedule_team_date ON cbb_schedule_items(team_id,game_date);

CREATE TABLE IF NOT EXISTS cbb_directory_population_runs (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  source_run_id TEXT NOT NULL,
  source_sha TEXT NOT NULL,
  status TEXT NOT NULL,
  canonical_teams INTEGER NOT NULL DEFAULT 0,
  players INTEGER NOT NULL DEFAULT 0,
  roster_memberships INTEGER NOT NULL DEFAULT 0,
  state_events INTEGER NOT NULL DEFAULT 0,
  team_snapshots INTEGER NOT NULL DEFAULT 0,
  player_snapshots INTEGER NOT NULL DEFAULT 0,
  schedule_items INTEGER NOT NULL DEFAULT 0,
  qa_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cbb_state_overlay_governance (
  state_family TEXT PRIMARY KEY,
  overlay_version TEXT NOT NULL DEFAULT 'FBIS-STATE-OVERLAY-v1',
  mode TEXT NOT NULL DEFAULT 'RESEARCH',
  target_scope TEXT NOT NULL,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR REPLACE INTO cbb_state_overlay_governance
(state_family,overlay_version,mode,target_scope,can_influence_projection,can_qualify,can_authorize_wager,notes,updated_at)
VALUES
('TEAM_PLAYER_DIRECTORY','FBIS-STATE-OVERLAY-v1','ACTIVE_INFRASTRUCTURE','CONTEXT_ONLY',0,0,0,'Persistent CBB identity/state infrastructure only.',datetime('now')),
('POSSESSION','FBIS-STATE-OVERLAY-v1','RESEARCH','MARGIN:RESEARCH|TOTALS:REJECT|WIN_PROB:KEEP',0,0,0,'PIT freeze policy.',datetime('now')),
('LINEUP','FBIS-STATE-OVERLAY-v1','RESEARCH','MARGIN:RESEARCH|TOTALS:REJECT|WIN_PROB:KEEP',0,0,0,'PIT freeze policy.',datetime('now')),
('SHOT_CLOCK','FBIS-STATE-OVERLAY-v1','RESEARCH','MARGIN:REJECT|TOTALS:REJECT|WIN_PROB:RESEARCH',0,0,0,'PIT freeze policy.',datetime('now')),
('PLAYER_ROTATION','FBIS-STATE-OVERLAY-v1','RESEARCH','MARGIN:RESEARCH|TOTALS:REJECT|WIN_PROB:RESEARCH',0,0,0,'PIT freeze policy.',datetime('now')),
('PLAYER_ROTATION_X_LINEUP','FBIS-STATE-OVERLAY-v1','RESEARCH','MARGIN:KEEP|TOTALS:REJECT|WIN_PROB:KEEP',0,0,0,'PIT freeze policy.',datetime('now')),
('COMBINED','FBIS-STATE-OVERLAY-v1','RESEARCH','MARGIN:KEEP|TOTALS:REJECT|WIN_PROB:KEEP',0,0,0,'PIT freeze policy.',datetime('now'));

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0079_cbb_persistent_directory_phase_a',datetime('now'));
