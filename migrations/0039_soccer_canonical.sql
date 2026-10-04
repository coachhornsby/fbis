-- Canonical point-in-time soccer match history for FBIS research.
-- Market observations remain outside this table; this is independent source data only.

CREATE TABLE IF NOT EXISTS soccer_matches (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  league TEXT NOT NULL,
  season INTEGER NOT NULL,
  start_time TEXT,
  match_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'FINAL',
  home_team_key TEXT NOT NULL,
  home_team_id TEXT,
  home_team_name TEXT,
  away_team_key TEXT NOT NULL,
  away_team_id TEXT,
  away_team_name TEXT,
  home_score REAL NOT NULL,
  away_score REAL NOT NULL,
  home_shots REAL,
  away_shots REAL,
  home_shots_on_target REAL,
  away_shots_on_target REAL,
  home_possession REAL,
  away_possession REAL,
  home_corners REAL,
  away_corners REAL,
  source TEXT NOT NULL DEFAULT 'espn',
  source_observed_at TEXT,
  provenance_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (league, event_id)
);

CREATE INDEX IF NOT EXISTS idx_soccer_matches_league_date
  ON soccer_matches (league, match_date, event_id);

CREATE INDEX IF NOT EXISTS idx_soccer_matches_league_season_date
  ON soccer_matches (league, season, match_date, event_id);

CREATE INDEX IF NOT EXISTS idx_soccer_matches_home_team_date
  ON soccer_matches (home_team_key, match_date);

CREATE INDEX IF NOT EXISTS idx_soccer_matches_away_team_date
  ON soccer_matches (away_team_key, match_date);

INSERT OR IGNORE INTO fbis_ops_components
(component_id, component_name, component_type, sport_or_domain, provider, criticality,
 expected_cadence_minutes, grace_period_minutes, stale_after_minutes, escalation_after_minutes,
 paid_provider, health_endpoint, target_table, config_json)
VALUES
('soccer-canonical-history', 'Soccer canonical history', 'ingest', 'soccer', 'espn', 'standard',
 1440, 180, 2160, 2880, 0, '/api/health', 'soccer_matches',
 '{"pointInTime":true,"marketFree":true,"leagues":["eng.1","esp.1","ger.1","ita.1","fra.1","usa.1","usa.nwsl"]}');

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0039_soccer_canonical', datetime('now'));
