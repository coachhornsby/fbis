-- CBBD season-wide shooting/efficiency profiles. Research-only and point-in-time.
-- One leaderboard request produces profiles for all returned D-I teams.
-- No live page request may fetch this source or grant wagering authority.
CREATE TABLE IF NOT EXISTS cbb_team_profile_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  canonical_team_id TEXT NOT NULL,
  provider_team_id TEXT,
  season INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'cbbd',
  source_endpoint TEXT NOT NULL DEFAULT '/stats/team/leaderboard',
  profile_version TEXT NOT NULL DEFAULT 'cbb-team-profile-v1',
  profile_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  job_run_id TEXT,
  research_only INTEGER NOT NULL DEFAULT 1 CHECK (research_only = 1),
  can_influence_projection INTEGER NOT NULL DEFAULT 0 CHECK (can_influence_projection = 0),
  can_qualify INTEGER NOT NULL DEFAULT 0 CHECK (can_qualify = 0),
  can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK (can_authorize_wager = 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_profile_team_season_pit
  ON cbb_team_profile_snapshots(canonical_team_id, season, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cbb_profile_season
  ON cbb_team_profile_snapshots(season, observed_at DESC);
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
  VALUES('0106_cbb_team_profile_snapshots',datetime('now'));
