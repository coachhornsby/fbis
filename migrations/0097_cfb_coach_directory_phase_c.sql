-- CFB Phase C: canonical coaching identity and temporal staff-role state.
-- Infrastructure/research only. No projection, qualification, or wagering authority.

CREATE TABLE IF NOT EXISTS cfb_canonical_staff (
  person_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  identity_status TEXT NOT NULL DEFAULT 'RESOLVED',
  identity_confidence REAL,
  active INTEGER NOT NULL DEFAULT 0,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cfb_staff_provider_ids (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_person_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence REAL,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider,provider_person_id)
);
CREATE INDEX IF NOT EXISTS idx_cfb_staff_provider_person
  ON cfb_staff_provider_ids(person_id,provider);

CREATE TABLE IF NOT EXISTS cfb_staff_aliases (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL,
  UNIQUE(person_id,normalized_alias,source)
);
CREATE INDEX IF NOT EXISTS idx_cfb_staff_alias_lookup
  ON cfb_staff_aliases(normalized_alias);

CREATE TABLE IF NOT EXISTS cfb_staff_role_assignments (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  team_id TEXT,
  source_team_name TEXT NOT NULL,
  role TEXT NOT NULL,
  season INTEGER NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  temporal_precision TEXT NOT NULL DEFAULT 'SEASON',
  interim INTEGER NOT NULL DEFAULT 0,
  explicit_play_caller INTEGER,
  pit_resolvable INTEGER NOT NULL DEFAULT 0,
  temporal_confidence REAL NOT NULL DEFAULT 0.60,
  source TEXT NOT NULL,
  source_timestamp TEXT,
  observed_at TEXT NOT NULL,
  raw_json TEXT,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(person_id,source_team_name,role,season,source)
);
CREATE INDEX IF NOT EXISTS idx_cfb_staff_role_team_season
  ON cfb_staff_role_assignments(team_id,season,role);
CREATE INDEX IF NOT EXISTS idx_cfb_staff_role_person_season
  ON cfb_staff_role_assignments(person_id,season,role);

CREATE TABLE IF NOT EXISTS cfb_staff_source_coverage (
  source TEXT NOT NULL,
  season INTEGER NOT NULL,
  source_rows INTEGER NOT NULL DEFAULT 0,
  canonical_staff INTEGER NOT NULL DEFAULT 0,
  role_assignments INTEGER NOT NULL DEFAULT 0,
  resolved_team_assignments INTEGER NOT NULL DEFAULT 0,
  unresolved_team_assignments INTEGER NOT NULL DEFAULT 0,
  pit_resolvable_assignments INTEGER NOT NULL DEFAULT 0,
  pit_unresolved_assignments INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(source,season)
);

INSERT OR IGNORE INTO cfb_state_overlay_governance
(state_family,overlay_version,mode,can_influence_projection,can_qualify,can_authorize_wager,notes,updated_at)
VALUES
('STAFF_DIRECTORY','FBIS-STATE-OVERLAY-v1','ACTIVE_INFRASTRUCTURE',0,0,0,'Canonical CFB staff identity; infrastructure only.',datetime('now')),
('COACH_ROLE_STATE','FBIS-STATE-OVERLAY-v1','RESEARCH',0,0,0,'Temporal coach/staff roles; no projection authority.',datetime('now'));

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0097_cfb_coach_directory_phase_c',datetime('now'));