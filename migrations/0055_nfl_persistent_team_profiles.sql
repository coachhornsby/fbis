-- Persistent NFL team/player operating profiles.
CREATE TABLE IF NOT EXISTS nfl_team_profiles (
  team_id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  team_name TEXT NOT NULL,
  as_of TEXT NOT NULL,
  season INTEGER,
  head_coach_id TEXT,
  head_coach_name TEXT,
  offensive_coordinator_name TEXT,
  defensive_coordinator_name TEXT,
  roster_json TEXT NOT NULL,
  availability_json TEXT NOT NULL,
  coaching_json TEXT,
  style_json TEXT,
  schedule_json TEXT NOT NULL,
  schedule_weak_spots_json TEXT NOT NULL,
  travel_json TEXT,
  profile_json TEXT NOT NULL,
  state_confidence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfl_team_profiles_key ON nfl_team_profiles(team_key);

CREATE TABLE IF NOT EXISTS nfl_team_profile_snapshots (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  as_of TEXT NOT NULL,
  season INTEGER,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nfl_team_profile_snapshots_time ON nfl_team_profile_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS nfl_player_state_profiles (
  player_id TEXT PRIMARY KEY,
  player_name TEXT NOT NULL,
  team_id TEXT,
  team_key TEXT,
  position TEXT,
  as_of TEXT NOT NULL,
  status TEXT NOT NULL,
  state_source TEXT NOT NULL,
  state_source_timestamp TEXT,
  injury_detail TEXT,
  injury_type TEXT,
  injury_severity TEXT,
  carried_forward INTEGER NOT NULL DEFAULT 0,
  depth_rank INTEGER,
  snap_share REAL,
  role TEXT,
  replacement_json TEXT,
  state_confidence REAL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nfl_player_state_team ON nfl_player_state_profiles(team_key,status);
CREATE INDEX IF NOT EXISTS idx_nfl_player_state_time ON nfl_player_state_profiles(state_source_timestamp DESC);

CREATE TABLE IF NOT EXISTS nfl_player_state_events (
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
CREATE INDEX IF NOT EXISTS idx_nfl_player_state_events_player ON nfl_player_state_events(player_id,source_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_nfl_player_state_events_name ON nfl_player_state_events(player_name,source_timestamp DESC);

CREATE TABLE IF NOT EXISTS nfl_team_schedule_items (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  game_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  opponent_key TEXT,
  venue_team_key TEXT,
  venue_name TEXT,
  venue_city TEXT,
  venue_country TEXT,
  home_away TEXT,
  neutral_site INTEGER NOT NULL DEFAULT 0,
  international INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  rest_days REAL,
  short_week INTEGER NOT NULL DEFAULT 0,
  extended_rest INTEGER NOT NULL DEFAULT 0,
  travel_miles REAL,
  time_zones_crossed INTEGER,
  altitude_feet REAL,
  schedule_stress_score REAL,
  stress_level TEXT,
  stress_reasons_json TEXT,
  raw_json TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nfl_schedule_team_time ON nfl_team_schedule_items(team_key,start_time);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0055_nfl_persistent_team_profiles', datetime('now'));
