-- CBB Persistent Directory Phase B: verified enrichment + PIT game-state overlays.
-- Research/SHADOW infrastructure only. No production, qualification, or wager authority.

CREATE TABLE IF NOT EXISTS cbb_player_provider_ids (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, provider TEXT NOT NULL, provider_player_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL, observed_at TEXT NOT NULL, confidence REAL NOT NULL,
  provenance_json TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(provider,provider_player_id)
);
CREATE INDEX IF NOT EXISTS idx_cbb_provider_player ON cbb_player_provider_ids(player_id);

CREATE TABLE IF NOT EXISTS cbb_roster_observations (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, team_id TEXT NOT NULL, season INTEGER NOT NULL,
  provider_player_id TEXT, canonical_name TEXT NOT NULL, position TEXT, class_year TEXT, height_text TEXT,
  observed_at TEXT NOT NULL, effective_at TEXT NOT NULL, ingested_at TEXT NOT NULL,
  source TEXT NOT NULL, provenance_json TEXT NOT NULL, confidence REAL NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0, supersedes_id TEXT, pit_eligible INTEGER NOT NULL DEFAULT 1,
  research_only INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_roster_obs_pit ON cbb_roster_observations(team_id,effective_at,observed_at);

CREATE TABLE IF NOT EXISTS cbb_rotation_observations (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, team_id TEXT NOT NULL, season INTEGER NOT NULL,
  as_of TEXT NOT NULL, games INTEGER, starts INTEGER, minutes REAL, minutes_per_game REAL,
  recent_minutes REAL, expected_minutes REAL, starter_evidence REAL, rotation_rank INTEGER,
  usage_rate REAL, source TEXT NOT NULL, provenance_json TEXT NOT NULL, confidence REAL NOT NULL,
  observed_at TEXT NOT NULL, effective_at TEXT NOT NULL, ingested_at TEXT NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0, supersedes_id TEXT, pit_eligible INTEGER NOT NULL DEFAULT 1,
  research_only INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_rotation_pit ON cbb_rotation_observations(team_id,effective_at,observed_at);

CREATE TABLE IF NOT EXISTS cbb_availability_observations (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, team_id TEXT NOT NULL, status TEXT NOT NULL,
  injury_status TEXT, observed_at TEXT NOT NULL, effective_at TEXT NOT NULL, ingested_at TEXT NOT NULL,
  source TEXT NOT NULL, provenance_json TEXT NOT NULL, confidence REAL NOT NULL, stale INTEGER NOT NULL DEFAULT 0,
  supersedes_id TEXT, pit_eligible INTEGER NOT NULL DEFAULT 1, research_only INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  CHECK(status IN ('AVAILABLE','QUESTIONABLE','DOUBTFUL','OUT','SUSPENDED','UNKNOWN'))
);
CREATE INDEX IF NOT EXISTS idx_cbb_availability_pit ON cbb_availability_observations(team_id,effective_at,observed_at);

CREATE TABLE IF NOT EXISTS cbb_team_context_observations (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL, season INTEGER NOT NULL, conference TEXT, head_coach TEXT,
  coach_tenure_start TEXT, venue_id TEXT, venue_name TEXT, venue_latitude REAL, venue_longitude REAL,
  hca_reference REAL, observed_at TEXT NOT NULL, effective_at TEXT NOT NULL, ingested_at TEXT NOT NULL,
  source TEXT NOT NULL, provenance_json TEXT NOT NULL, confidence REAL NOT NULL, stale INTEGER NOT NULL DEFAULT 0,
  supersedes_id TEXT, pit_eligible INTEGER NOT NULL DEFAULT 1, research_only INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_team_context_pit ON cbb_team_context_observations(team_id,effective_at,observed_at);

CREATE TABLE IF NOT EXISTS cbb_game_state_snapshots (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, season INTEGER NOT NULL, game_start TEXT NOT NULL,
  feature_cutoff TEXT NOT NULL, home_team_id TEXT NOT NULL, away_team_id TEXT NOT NULL,
  home_state_json TEXT NOT NULL, away_state_json TEXT NOT NULL, unresolved_json TEXT NOT NULL,
  temporal_integrity_ok INTEGER NOT NULL, post_tip_observations INTEGER NOT NULL DEFAULT 0,
  future_membership_leaks INTEGER NOT NULL DEFAULT 0, future_availability_leaks INTEGER NOT NULL DEFAULT 0,
  future_lineup_leaks INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL DEFAULT 'SHADOW',
  overlay_version TEXT NOT NULL DEFAULT 'FBIS-STATE-OVERLAY-v1',
  research_only INTEGER NOT NULL DEFAULT 1, can_influence_projection INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0, can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  provenance_json TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(game_id,feature_cutoff)
);
CREATE INDEX IF NOT EXISTS idx_cbb_game_state_cutoff ON cbb_game_state_snapshots(feature_cutoff,game_start);

CREATE TABLE IF NOT EXISTS cbb_shadow_challenger_definitions (
  id TEXT PRIMARY KEY, target TEXT NOT NULL, family TEXT NOT NULL, evidence_policy TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'SHADOW', overlay_version TEXT NOT NULL DEFAULT 'FBIS-STATE-OVERLAY-v1',
  can_influence_projection INTEGER NOT NULL DEFAULT 0, can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  UNIQUE(target,family)
);

INSERT OR REPLACE INTO cbb_shadow_challenger_definitions VALUES
('cbb-shadow-margin-rotation-lineup','MARGIN','PLAYER_ROTATION_X_LINEUP','KEEP','SHADOW','FBIS-STATE-OVERLAY-v1',0,0,0,datetime('now')),
('cbb-shadow-margin-combined','MARGIN','COMBINED','KEEP','SHADOW','FBIS-STATE-OVERLAY-v1',0,0,0,datetime('now')),
('cbb-shadow-margin-possession','MARGIN','POSSESSION','RESEARCH','SHADOW','FBIS-STATE-OVERLAY-v1',0,0,0,datetime('now')),
('cbb-shadow-margin-lineup','MARGIN','LINEUP','RESEARCH','SHADOW','FBIS-STATE-OVERLAY-v1',0,0,0,datetime('now')),
('cbb-shadow-margin-player','MARGIN','PLAYER_ROTATION','RESEARCH','SHADOW','FBIS-STATE-OVERLAY-v1',0,0,0,datetime('now')),
('cbb-shadow-win-possession','WIN_PROB','POSSESSION','KEEP','SHADOW','FBIS-STATE-OVERLAY-v1',0,0,0,datetime('now')),
('cbb-shadow-win-lineup','WIN_PROB','LINEUP','KEEP','SHADOW','FBIS-STATE-OVERLAY-v1',0,0,0,datetime('now')),
('cbb-shadow-win-rotation-lineup','WIN_PROB','PLAYER_ROTATION_X_LINEUP','KEEP','SHADOW','FBIS-STATE-OVERLAY-v1',0,0,0,datetime('now')),
('cbb-shadow-win-combined','WIN_PROB','COMBINED','KEEP','SHADOW','FBIS-STATE-OVERLAY-v1',0,0,0,datetime('now')),
('cbb-shadow-win-shot-clock','WIN_PROB','SHOT_CLOCK','RESEARCH','SHADOW','FBIS-STATE-OVERLAY-v1',0,0,0,datetime('now')),
('cbb-shadow-win-player','WIN_PROB','PLAYER_ROTATION','RESEARCH','SHADOW','FBIS-STATE-OVERLAY-v1',0,0,0,datetime('now'));
