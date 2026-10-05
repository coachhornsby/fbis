-- Persistent MLB team/player state. Expensive upstream fanout is scheduled; live boards read D1.
CREATE TABLE IF NOT EXISTS mlb_team_profiles (
  team_id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  team_name TEXT NOT NULL,
  season INTEGER,
  as_of TEXT NOT NULL,
  roster_json TEXT NOT NULL,
  rotation_json TEXT,
  bullpen_json TEXT,
  lineup_json TEXT,
  schedule_json TEXT,
  profile_json TEXT NOT NULL,
  state_confidence REAL,
  source_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_team_profiles_key ON mlb_team_profiles(team_key);
CREATE INDEX IF NOT EXISTS idx_mlb_team_profiles_asof ON mlb_team_profiles(as_of DESC);

CREATE TABLE IF NOT EXISTS mlb_team_profile_snapshots (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  season INTEGER,
  as_of TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_team_profile_snapshots_team_time
  ON mlb_team_profile_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS mlb_player_state_profiles (
  player_id TEXT PRIMARY KEY,
  player_name TEXT NOT NULL,
  team_id TEXT,
  team_key TEXT,
  position TEXT,
  roster_status TEXT NOT NULL,
  as_of TEXT NOT NULL,
  state_source TEXT NOT NULL,
  carried_forward INTEGER NOT NULL DEFAULT 0,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_player_state_team
  ON mlb_player_state_profiles(team_id,roster_status);

CREATE TABLE IF NOT EXISTS mlb_pitcher_profiles (
  player_id TEXT PRIMARY KEY,
  player_name TEXT NOT NULL,
  team_id TEXT,
  team_key TEXT,
  as_of TEXT NOT NULL,
  innings_per_start REAL,
  batters_faced_per_inning REAL,
  expected_innings REAL,
  recent_velocity REAL,
  recent_pitch_mix_json TEXT,
  statcast_profile_json TEXT,
  profile_json TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_pitcher_profiles_team
  ON mlb_pitcher_profiles(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS mlb_hitter_profiles (
  player_id TEXT PRIMARY KEY,
  player_name TEXT NOT NULL,
  team_id TEXT,
  team_key TEXT,
  as_of TEXT NOT NULL,
  handedness TEXT,
  lineup_role TEXT,
  statcast_profile_json TEXT,
  profile_json TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_hitter_profiles_team
  ON mlb_hitter_profiles(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS mlb_team_schedule_items (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  game_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  opponent_id TEXT,
  opponent_key TEXT,
  home_away TEXT,
  game_type TEXT,
  series_description TEXT,
  series_game_number INTEGER,
  games_in_series INTEGER,
  completed INTEGER NOT NULL DEFAULT 0,
  rest_days REAL,
  day_after_night INTEGER NOT NULL DEFAULT 0,
  doubleheader INTEGER NOT NULL DEFAULT 0,
  consecutive_road_games INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_schedule_team_time
  ON mlb_team_schedule_items(team_id,start_time);
CREATE INDEX IF NOT EXISTS idx_mlb_schedule_game ON mlb_team_schedule_items(game_id);

CREATE TABLE IF NOT EXISTS mlb_profile_refresh_state (
  shard_key TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  status TEXT NOT NULL,
  teams_processed INTEGER NOT NULL DEFAULT 0,
  players_processed INTEGER NOT NULL DEFAULT 0,
  source_calls INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  cursor_json TEXT,
  details_json TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0055_mlb_persistent_profiles',datetime('now'));
