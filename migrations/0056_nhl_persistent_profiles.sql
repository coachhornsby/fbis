-- Persistent NHL team/player/deployment operating profiles.
-- Expensive source refresh is asynchronous. Projection requests read compact D1 state only.

CREATE TABLE IF NOT EXISTS nhl_team_profiles (
  team_key TEXT PRIMARY KEY,
  team_abbr TEXT NOT NULL,
  official_abbr TEXT NOT NULL,
  team_name TEXT,
  season_id INTEGER NOT NULL,
  profile_version TEXT NOT NULL,
  roster_count INTEGER NOT NULL DEFAULT 0,
  active_count INTEGER NOT NULL DEFAULT 0,
  scratch_count INTEGER NOT NULL DEFAULT 0,
  unavailable_count INTEGER NOT NULL DEFAULT 0,
  next_game_id TEXT,
  next_game_start TEXT,
  next_opponent_key TEXT,
  next_site TEXT,
  rest_days REAL,
  back_to_back INTEGER NOT NULL DEFAULT 0,
  three_in_four INTEGER NOT NULL DEFAULT 0,
  four_in_six INTEGER NOT NULL DEFAULT 0,
  road_trip_game_number INTEGER NOT NULL DEFAULT 0,
  travel_miles REAL,
  time_zones_crossed INTEGER,
  schedule_stress_score REAL,
  schedule_flags_json TEXT,
  deployment_json TEXT,
  goalie_json TEXT,
  coach_json TEXT,
  style_json TEXT,
  state_confidence REAL,
  source_updated_at TEXT,
  updated_at TEXT NOT NULL,
  profile_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nhl_player_profiles (
  player_key TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  player_name TEXT NOT NULL,
  position TEXT,
  sweater_number TEXT,
  roster_status TEXT,
  availability_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  game_state TEXT NOT NULL DEFAULT 'EXPECTED_ACTIVE',
  injury_detail TEXT,
  ev_line INTEGER,
  d_pair INTEGER,
  pp_unit INTEGER,
  pk_unit INTEGER,
  last_game_id TEXT,
  last_game_at TEXT,
  last_toi_seconds REAL,
  rolling_toi_seconds REAL,
  rolling_pp_toi_seconds REAL,
  shots_per_game REAL,
  points_per_game REAL,
  role_confidence REAL,
  state_confidence REAL,
  source TEXT,
  source_updated_at TEXT,
  carried_state INTEGER NOT NULL DEFAULT 0,
  replacement_json TEXT,
  linemate_json TEXT,
  raw_json TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_player_profiles_team_role
  ON nhl_player_profiles(team_key,position,ev_line,d_pair,pp_unit);
CREATE INDEX IF NOT EXISTS idx_nhl_player_profiles_state
  ON nhl_player_profiles(availability_state,source_updated_at DESC);

CREATE TABLE IF NOT EXISTS nhl_goalie_profiles (
  player_id TEXT PRIMARY KEY,
  player_name TEXT NOT NULL,
  team_key TEXT NOT NULL,
  hierarchy_rank INTEGER,
  goalie_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  expected_start_probability REAL,
  games INTEGER,
  starts INTEGER,
  save_pct REAL,
  gaa REAL,
  last_game_id TEXT,
  last_game_at TEXT,
  rolling_shots_faced REAL,
  rolling_saves REAL,
  rest_days REAL,
  state_confidence REAL,
  source_updated_at TEXT,
  raw_json TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_goalie_profiles_team
  ON nhl_goalie_profiles(team_key,hierarchy_rank);

CREATE TABLE IF NOT EXISTS nhl_linemate_profiles (
  id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  player_id TEXT NOT NULL,
  teammate_id TEXT NOT NULL,
  games_sample INTEGER NOT NULL DEFAULT 0,
  shared_seconds REAL NOT NULL DEFAULT 0,
  shared_seconds_per_game REAL,
  overlap_share REAL,
  strength_state TEXT NOT NULL DEFAULT 'ALL_SITUATIONS',
  last_game_id TEXT,
  last_observed_at TEXT,
  confidence REAL,
  raw_json TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(team_key,player_id,teammate_id,strength_state)
);
CREATE INDEX IF NOT EXISTS idx_nhl_linemate_profiles_player
  ON nhl_linemate_profiles(team_key,player_id,shared_seconds DESC);

CREATE TABLE IF NOT EXISTS nhl_deployment_observations (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  game_start TEXT,
  team_key TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT,
  position TEXT,
  ev_line INTEGER,
  d_pair INTEGER,
  pp_unit INTEGER,
  pk_unit INTEGER,
  toi_seconds REAL,
  scratch INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_deployment_obs_team_time
  ON nhl_deployment_observations(team_key,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_nhl_deployment_obs_player_time
  ON nhl_deployment_observations(player_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS nhl_team_schedule_profile (
  id TEXT PRIMARY KEY,
  season_id INTEGER NOT NULL,
  team_key TEXT NOT NULL,
  game_id TEXT NOT NULL,
  game_type INTEGER,
  start_time TEXT,
  game_state TEXT,
  home_team_key TEXT,
  away_team_key TEXT,
  opponent_key TEXT,
  site TEXT,
  venue_name TEXT,
  neutral_site INTEGER NOT NULL DEFAULT 0,
  days_rest REAL,
  back_to_back INTEGER NOT NULL DEFAULT 0,
  three_in_four INTEGER NOT NULL DEFAULT 0,
  four_in_six INTEGER NOT NULL DEFAULT 0,
  road_trip_game_number INTEGER NOT NULL DEFAULT 0,
  travel_miles REAL,
  time_zones_crossed INTEGER,
  schedule_stress_score REAL,
  stress_flags_json TEXT,
  source_updated_at TEXT,
  raw_json TEXT,
  UNIQUE(season_id,team_key,game_id)
);
CREATE INDEX IF NOT EXISTS idx_nhl_team_schedule_team_time
  ON nhl_team_schedule_profile(season_id,team_key,start_time);

CREATE TABLE IF NOT EXISTS nhl_team_profile_snapshots (
  id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  season_id INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_team_profile_snapshots_time
  ON nhl_team_profile_snapshots(team_key,as_of DESC);

CREATE TABLE IF NOT EXISTS nhl_team_coach_history (
  id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  season_id INTEGER NOT NULL,
  coach_name TEXT NOT NULL,
  role TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_team_coach_history_team
  ON nhl_team_coach_history(team_key,observed_at DESC);

CREATE TABLE IF NOT EXISTS nhl_profile_sync_runs (
  id TEXT PRIMARY KEY,
  season_id INTEGER NOT NULL,
  team_key TEXT,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  source_calls INTEGER NOT NULL DEFAULT 0,
  roster_rows INTEGER NOT NULL DEFAULT 0,
  schedule_rows INTEGER NOT NULL DEFAULT 0,
  player_rows_upserted INTEGER NOT NULL DEFAULT 0,
  goalie_rows_upserted INTEGER NOT NULL DEFAULT 0,
  linemate_rows_upserted INTEGER NOT NULL DEFAULT 0,
  deployment_rows_upserted INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_nhl_profile_sync_runs_time
  ON nhl_profile_sync_runs(started_at DESC,team_key);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0056_nhl_persistent_profiles',datetime('now'));
