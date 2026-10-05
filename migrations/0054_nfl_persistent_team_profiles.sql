-- Persistent NFL team/player operating profiles.
-- Current state is mutable; source observations remain immutable in their source tables.

CREATE TABLE IF NOT EXISTS nfl_team_profiles (
  team_key TEXT PRIMARY KEY,
  team_name TEXT,
  espn_team_id TEXT,
  season INTEGER NOT NULL,
  head_coach TEXT,
  offensive_coordinator TEXT,
  defensive_coordinator TEXT,
  coach_source TEXT,
  roster_count INTEGER NOT NULL DEFAULT 0,
  injured_count INTEGER NOT NULL DEFAULT 0,
  out_count INTEGER NOT NULL DEFAULT 0,
  questionable_count INTEGER NOT NULL DEFAULT 0,
  doubtful_count INTEGER NOT NULL DEFAULT 0,
  limited_count INTEGER NOT NULL DEFAULT 0,
  practice_dnp_count INTEGER NOT NULL DEFAULT 0,
  next_game_id TEXT,
  next_game_start TEXT,
  next_opponent_key TEXT,
  next_site TEXT,
  days_rest REAL,
  short_week INTEGER NOT NULL DEFAULT 0,
  post_bye INTEGER NOT NULL DEFAULT 0,
  road_trip_game_number INTEGER,
  road_games_last_4 INTEGER,
  three_road_in_four INTEGER NOT NULL DEFAULT 0,
  travel_miles REAL,
  time_zones_crossed INTEGER,
  altitude_feet REAL,
  international INTEGER NOT NULL DEFAULT 0,
  schedule_stress_score REAL,
  schedule_flags_json TEXT,
  identity_json TEXT,
  updated_at TEXT NOT NULL,
  source_updated_at TEXT,
  source_json TEXT
);

CREATE TABLE IF NOT EXISTS nfl_player_profiles (
  player_key TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  position TEXT,
  jersey TEXT,
  roster_status TEXT,
  depth_rank INTEGER,
  role_label TEXT,
  last_known_snap_share REAL,
  health_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  practice_state TEXT,
  injury_detail TEXT,
  injury_onset_at TEXT,
  injury_severity_class TEXT,
  expected_return_state TEXT,
  expected_snap_share REAL,
  state_confidence REAL,
  state_source TEXT,
  state_source_updated_at TEXT,
  last_game_played_at TEXT,
  last_game_snap_share REAL,
  replacement_json TEXT,
  active_confirmation_at TEXT,
  carried_state INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_nfl_player_profiles_team
  ON nfl_player_profiles(team_key, position, depth_rank);

CREATE INDEX IF NOT EXISTS idx_nfl_player_profiles_health
  ON nfl_player_profiles(health_state, updated_at);

CREATE TABLE IF NOT EXISTS nfl_team_schedule_profile (
  id TEXT PRIMARY KEY,
  season INTEGER NOT NULL,
  team_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  week INTEGER,
  season_type TEXT,
  start_time TEXT,
  home_team_key TEXT,
  away_team_key TEXT,
  opponent_key TEXT,
  site TEXT,
  venue_name TEXT,
  venue_city TEXT,
  neutral_site INTEGER NOT NULL DEFAULT 0,
  international INTEGER NOT NULL DEFAULT 0,
  days_rest REAL,
  short_week INTEGER NOT NULL DEFAULT 0,
  post_bye INTEGER NOT NULL DEFAULT 0,
  road_trip_game_number INTEGER,
  road_games_last_4 INTEGER,
  three_road_in_four INTEGER NOT NULL DEFAULT 0,
  travel_miles REAL,
  time_zones_crossed INTEGER,
  altitude_feet REAL,
  schedule_stress_score REAL,
  stress_flags_json TEXT,
  source_updated_at TEXT,
  raw_json TEXT,
  UNIQUE(season, team_key, event_id)
);

CREATE INDEX IF NOT EXISTS idx_nfl_team_schedule_profile_team_time
  ON nfl_team_schedule_profile(season, team_key, start_time);

CREATE TABLE IF NOT EXISTS nfl_profile_sync_runs (
  id TEXT PRIMARY KEY,
  season INTEGER NOT NULL,
  team_key TEXT,
  status TEXT NOT NULL,
  source TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  roster_rows INTEGER NOT NULL DEFAULT 0,
  schedule_rows INTEGER NOT NULL DEFAULT 0,
  injury_rows INTEGER NOT NULL DEFAULT 0,
  player_rows_upserted INTEGER NOT NULL DEFAULT 0,
  schedule_rows_upserted INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_nfl_profile_sync_runs_time
  ON nfl_profile_sync_runs(started_at DESC, team_key);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0054_nfl_persistent_team_profiles', datetime('now'));
