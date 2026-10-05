-- Idempotent observations of who actually absorbs role when an NHL player is scratched.
-- Used only as persistent research context until separately validated.

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
CREATE INDEX IF NOT EXISTS idx_nhl_replacement_unavailable
  ON nhl_replacement_observations(team_key,unavailable_player_id,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_nhl_replacement_replacement
  ON nhl_replacement_observations(team_key,replacement_player_id,observed_at DESC);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0059_nhl_replacement_observations',datetime('now'));
