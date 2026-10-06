-- KBO / NPB Phase 3 frozen pregame state foundation.
-- Reconstructed snapshots are built only from official final games strictly before
-- the target game date. Unsupported historical features remain explicitly missing.

CREATE TABLE IF NOT EXISTS asian_baseball_pregame_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  league TEXT NOT NULL CHECK (league IN ('KBO','NPB')),
  canonical_game_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  game_date TEXT NOT NULL,
  scheduled_start TEXT NOT NULL,
  snapshot_at TEXT NOT NULL,
  cutoff_minutes INTEGER NOT NULL,
  reconstruction_mode TEXT NOT NULL,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  home_team_state_json TEXT NOT NULL,
  away_team_state_json TEXT NOT NULL,
  starter_state_json TEXT NOT NULL,
  bullpen_state_json TEXT NOT NULL,
  park_state_json TEXT NOT NULL,
  lineup_state_json TEXT NOT NULL,
  missing_flags_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  model_outputs_json TEXT,
  temporal_eligible INTEGER NOT NULL DEFAULT 0,
  walk_forward_eligible INTEGER NOT NULL DEFAULT 0,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(canonical_game_id) REFERENCES asian_baseball_games(canonical_game_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_asian_baseball_pregame_game_kind
  ON asian_baseball_pregame_snapshots(league,canonical_game_id,reconstruction_mode);
CREATE INDEX IF NOT EXISTS idx_asian_baseball_pregame_temporal
  ON asian_baseball_pregame_snapshots(league,game_date,temporal_eligible,walk_forward_eligible);

CREATE TABLE IF NOT EXISTS asian_baseball_park_factors (
  id TEXT PRIMARY KEY,
  league TEXT NOT NULL CHECK (league IN ('KBO','NPB')),
  canonical_game_id TEXT NOT NULL,
  venue TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  prior_game_sample INTEGER NOT NULL,
  league_prior_game_sample INTEGER NOT NULL,
  raw_factor REAL,
  shrunk_factor REAL NOT NULL,
  shrink_games INTEGER NOT NULL,
  methodology_version TEXT NOT NULL,
  source_contract TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(canonical_game_id) REFERENCES asian_baseball_games(canonical_game_id)
);
CREATE INDEX IF NOT EXISTS idx_asian_baseball_park_asof
  ON asian_baseball_park_factors(league,venue,as_of_date);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0081_asian_baseball_pregame_foundation',datetime('now'));
