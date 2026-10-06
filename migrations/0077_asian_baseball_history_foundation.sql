-- KBO / NPB Phase 2 durable historical game/result foundation.
-- Shared storage, league-specific source provenance. Historical result observations are
-- explicitly post-start and never treated as pregame feature snapshots.

CREATE TABLE IF NOT EXISTS asian_baseball_games (
  canonical_game_id TEXT PRIMARY KEY,
  league TEXT NOT NULL CHECK (league IN ('KBO','NPB')),
  season INTEGER NOT NULL,
  source_game_id TEXT,
  game_date TEXT NOT NULL,
  scheduled_start TEXT,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  venue TEXT,
  game_status TEXT NOT NULL,
  home_final_runs INTEGER,
  away_final_runs INTEGER,
  innings_status_json TEXT,
  source_contract TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  result_observed_at TEXT,
  first_fetched_at TEXT NOT NULL,
  last_fetched_at TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  is_final INTEGER NOT NULL DEFAULT 0,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_asian_baseball_source_game
  ON asian_baseball_games(league,source_game_id)
  WHERE source_game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asian_baseball_games_league_date
  ON asian_baseball_games(league,game_date,canonical_game_id);
CREATE INDEX IF NOT EXISTS idx_asian_baseball_games_team_date
  ON asian_baseball_games(league,home_team_id,away_team_id,game_date);

CREATE TABLE IF NOT EXISTS asian_baseball_game_observations (
  id TEXT PRIMARY KEY,
  canonical_game_id TEXT NOT NULL,
  league TEXT NOT NULL CHECK (league IN ('KBO','NPB')),
  observation_type TEXT NOT NULL,
  relation_to_start TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  source_contract TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  payload_json TEXT,
  research_only INTEGER NOT NULL DEFAULT 1,
  pregame_eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(canonical_game_id) REFERENCES asian_baseball_games(canonical_game_id)
);
CREATE INDEX IF NOT EXISTS idx_asian_baseball_obs_game_time
  ON asian_baseball_game_observations(canonical_game_id,observed_at);
CREATE INDEX IF NOT EXISTS idx_asian_baseball_obs_temporal
  ON asian_baseball_game_observations(league,relation_to_start,observed_at);

CREATE TABLE IF NOT EXISTS asian_baseball_backfill_shards (
  id TEXT PRIMARY KEY,
  league TEXT NOT NULL CHECK (league IN ('KBO','NPB')),
  season INTEGER NOT NULL,
  month INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  cursor_date TEXT,
  max_requests INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','RUNNING','PARTIAL','DONE','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  requests_used INTEGER NOT NULL DEFAULT 0,
  games_discovered INTEGER NOT NULL DEFAULT 0,
  games_persisted INTEGER NOT NULL DEFAULT 0,
  malformed_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  lease_until TEXT,
  source_contract TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_asian_baseball_backfill_status
  ON asian_baseball_backfill_shards(status,league,season,month);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0077_asian_baseball_history_foundation',datetime('now'));
