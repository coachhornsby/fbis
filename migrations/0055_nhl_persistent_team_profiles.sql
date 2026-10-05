-- NHL persistent team/player/deployment state architecture (0055).
CREATE TABLE IF NOT EXISTS nhl_team_profiles (
  team_key TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  season_id TEXT NOT NULL,
  as_of TEXT NOT NULL,
  roster_json TEXT NOT NULL,
  availability_json TEXT NOT NULL,
  deployment_json TEXT NOT NULL,
  goalie_json TEXT NOT NULL,
  schedule_json TEXT NOT NULL,
  style_json TEXT,
  coach_json TEXT,
  profile_json TEXT NOT NULL,
  state_confidence REAL,
  source_freshness_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_team_profiles_asof ON nhl_team_profiles(as_of DESC);

CREATE TABLE IF NOT EXISTS nhl_team_profile_snapshots (
  id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  season_id TEXT NOT NULL,
  as_of TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_team_profile_snapshots_team_time
  ON nhl_team_profile_snapshots(team_key,as_of DESC);

CREATE TABLE IF NOT EXISTS nhl_player_state_profiles (
  player_id TEXT PRIMARY KEY,
  player_name TEXT NOT NULL,
  team_key TEXT NOT NULL,
  position TEXT,
  as_of TEXT NOT NULL,
  status TEXT NOT NULL,
  state_source TEXT NOT NULL,
  state_source_timestamp TEXT,
  carried_forward INTEGER NOT NULL DEFAULT 0,
  expected_toi_seconds REAL,
  expected_pp_toi_seconds REAL,
  ev_role TEXT,
  pp_unit TEXT,
  role_confidence REAL,
  shot_rate REAL,
  point_rate REAL,
  linemates_json TEXT,
  replacement_json TEXT,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_player_state_team ON nhl_player_state_profiles(team_key,status);
CREATE INDEX IF NOT EXISTS idx_nhl_player_state_time ON nhl_player_state_profiles(state_source_timestamp DESC);

CREATE TABLE IF NOT EXISTS nhl_player_state_events (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team_key TEXT NOT NULL,
  game_id TEXT,
  event_type TEXT NOT NULL,
  status TEXT,
  source TEXT NOT NULL,
  source_timestamp TEXT NOT NULL,
  evidence_rank INTEGER NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_state_events_player_time
  ON nhl_player_state_events(player_id,source_timestamp DESC);

CREATE TABLE IF NOT EXISTS nhl_deployment_observations (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT,
  position TEXT,
  observed_at TEXT NOT NULL,
  toi_seconds REAL,
  pp_toi_seconds REAL,
  ev_role TEXT,
  pp_unit TEXT,
  scratched INTEGER NOT NULL DEFAULT 0,
  linemates_json TEXT,
  source TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_deployment_team_time
  ON nhl_deployment_observations(team_key,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_nhl_deployment_player_time
  ON nhl_deployment_observations(player_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS nhl_linemate_edges (
  id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  linemate_id TEXT NOT NULL,
  overlap_seconds REAL NOT NULL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_linemate_player_time
  ON nhl_linemate_edges(player_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS nhl_goalie_state_profiles (
  player_id TEXT PRIMARY KEY,
  player_name TEXT,
  team_key TEXT NOT NULL,
  as_of TEXT NOT NULL,
  hierarchy_role TEXT NOT NULL,
  start_probability REAL,
  confirmed_state TEXT NOT NULL,
  last_start_at TEXT,
  consecutive_starts INTEGER NOT NULL DEFAULT 0,
  rolling_shots_faced REAL,
  rolling_saves REAL,
  state_confidence REAL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_goalie_team ON nhl_goalie_state_profiles(team_key,hierarchy_role);

CREATE TABLE IF NOT EXISTS nhl_replacement_profiles (
  player_id TEXT NOT NULL,
  replacement_player_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  sample_n INTEGER NOT NULL DEFAULT 0,
  toi_share REAL,
  pp_share REAL,
  shot_share REAL,
  point_share REAL,
  evidence_source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(player_id,replacement_player_id)
);
CREATE INDEX IF NOT EXISTS idx_nhl_replacement_team ON nhl_replacement_profiles(team_key,player_id);

CREATE TABLE IF NOT EXISTS nhl_team_schedule_items (
  id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  game_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  opponent_key TEXT,
  venue_team_key TEXT,
  home_away TEXT,
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
CREATE INDEX IF NOT EXISTS idx_nhl_schedule_team_time ON nhl_team_schedule_items(team_key,start_time);
CREATE INDEX IF NOT EXISTS idx_nhl_schedule_game ON nhl_team_schedule_items(game_id);

CREATE TABLE IF NOT EXISTS nhl_team_coach_history (
  id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  coach_id TEXT,
  coach_name TEXT NOT NULL,
  role TEXT,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_coach_team_time
  ON nhl_team_coach_history(team_key,observed_at DESC);

CREATE TABLE IF NOT EXISTS nhl_profile_runs (
  id TEXT PRIMARY KEY,
  run_at TEXT NOT NULL,
  season_id TEXT NOT NULL,
  teams INTEGER NOT NULL,
  players INTEGER NOT NULL,
  deployment_rows INTEGER NOT NULL,
  schedule_rows INTEGER NOT NULL,
  source_errors INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  details_json TEXT
);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0055_nhl_persistent_team_profiles',datetime('now'));
