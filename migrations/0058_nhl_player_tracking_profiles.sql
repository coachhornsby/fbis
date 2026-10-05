-- Persistent NHL player EDGE/tracking snapshots.
-- Refreshed asynchronously with team profiles; read by projections before live EDGE fallback.

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
CREATE INDEX IF NOT EXISTS idx_nhl_tracking_team_time
  ON nhl_player_tracking_profiles(team_key,source_as_of DESC);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0058_nhl_player_tracking_profiles',datetime('now'));
