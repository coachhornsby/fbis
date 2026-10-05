-- Persistent NBA team/player state profiles.
CREATE TABLE IF NOT EXISTS nba_team_profiles (
  team_id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  team_name TEXT NOT NULL,
  as_of TEXT NOT NULL,
  season INTEGER,
  head_coach_id TEXT,
  head_coach_name TEXT,
  coach_tenure_years REAL,
  roster_json TEXT NOT NULL,
  rotation_json TEXT NOT NULL,
  availability_json TEXT NOT NULL,
  style_json TEXT,
  schedule_json TEXT NOT NULL,
  schedule_weak_spots_json TEXT NOT NULL,
  travel_json TEXT,
  profile_json TEXT NOT NULL,
  state_confidence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nba_team_profiles_key ON nba_team_profiles(team_key);

CREATE TABLE IF NOT EXISTS nba_team_profile_snapshots (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  as_of TEXT NOT NULL,
  season INTEGER,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_team_profile_snapshots_time
  ON nba_team_profile_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS nba_player_state_profiles (
  player_id TEXT PRIMARY KEY,
  player_name TEXT NOT NULL,
  team_id TEXT,
  team_key TEXT,
  as_of TEXT NOT NULL,
  status TEXT NOT NULL,
  state_source TEXT NOT NULL,
  state_source_timestamp TEXT,
  injury_detail TEXT,
  injury_type TEXT,
  injury_severity TEXT,
  carried_forward INTEGER NOT NULL DEFAULT 0,
  expected_minutes REAL,
  rotation_role TEXT,
  starter_probability REAL,
  player_impact_net REAL,
  replacement_json TEXT,
  state_confidence REAL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_player_state_team
  ON nba_player_state_profiles(team_key,status);
CREATE INDEX IF NOT EXISTS idx_nba_player_state_time
  ON nba_player_state_profiles(state_source_timestamp DESC);

CREATE TABLE IF NOT EXISTS nba_player_state_events (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team_key TEXT,
  event_type TEXT NOT NULL,
  status TEXT,
  injury_detail TEXT,
  source TEXT NOT NULL,
  source_timestamp TEXT NOT NULL,
  evidence_rank INTEGER NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_player_state_events_player
  ON nba_player_state_events(player_id,source_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_nba_player_state_events_name
  ON nba_player_state_events(player_name,source_timestamp DESC);

CREATE TABLE IF NOT EXISTS nba_lineup_observations (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  team_key TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  lineup_status TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  tipoff_timestamp TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_lineup_obs_team_time
  ON nba_lineup_observations(team_key,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_nba_lineup_obs_player_time
  ON nba_lineup_observations(player_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS nba_team_schedule_items (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  game_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  opponent_key TEXT,
  venue_team_key TEXT,
  home_away TEXT,
  neutral_site INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  rest_days REAL,
  back_to_back INTEGER NOT NULL DEFAULT 0,
  three_in_four INTEGER NOT NULL DEFAULT 0,
  four_in_six INTEGER NOT NULL DEFAULT 0,
  travel_miles REAL,
  time_zones_crossed REAL,
  altitude_feet REAL,
  road_trip_game_number INTEGER NOT NULL DEFAULT 0,
  consecutive_road_games INTEGER NOT NULL DEFAULT 0,
  schedule_stress_score REAL,
  stress_reasons_json TEXT,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_team_schedule_team_time
  ON nba_team_schedule_items(team_id,start_time);
CREATE INDEX IF NOT EXISTS idx_nba_team_schedule_game
  ON nba_team_schedule_items(game_id);

CREATE TABLE IF NOT EXISTS nba_team_coach_history (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  coach_id TEXT,
  coach_name TEXT NOT NULL,
  role TEXT,
  experience_years REAL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_team_coach_history
  ON nba_team_coach_history(team_id,observed_at DESC);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0054_nba_persistent_team_profiles',datetime('now'));
