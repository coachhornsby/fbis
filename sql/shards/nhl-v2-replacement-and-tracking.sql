-- Additive NHL-only shadow migration, copied verbatim from PRIMARY schemas.
-- Never touches PRIMARY, never grants NHL production authority or wagering.
CREATE TABLE IF NOT EXISTS nhl_player_tracking_profiles (
  player_id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  player_name TEXT,
  position TEXT,
  available INTEGER NOT NULL DEFAULT 0,
  coverage REAL,
  max_skating_speed REAL,
  bursts_22_plus REAL,
  bursts_20_plus REAL,
  total_distance REAL,
  distance_per_60 REAL,
  max_shot_speed REAL,
  avg_shot_speed REAL,
  high_danger_shots REAL,
  slot_shots REAL,
  offensive_zone_pct REAL,
  source TEXT NOT NULL,
  source_as_of TEXT NOT NULL,
  raw_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nhl_replacement_observations (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  game_start TEXT,
  team_key TEXT NOT NULL,
  unavailable_player_id TEXT NOT NULL,
  unavailable_player_name TEXT,
  replacement_player_id TEXT NOT NULL,
  replacement_player_name TEXT,
  position_group TEXT,
  toi_delta_seconds REAL,
  pp_toi_delta_seconds REAL,
  ev_line_before INTEGER,
  ev_line_after INTEGER,
  pp_unit_before INTEGER,
  pp_unit_after INTEGER,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  raw_json TEXT,
  UNIQUE(game_id,unavailable_player_id,replacement_player_id)
);
