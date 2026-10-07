-- KBO/NPB Phase 4B.1: doubleheader-safe canonical game identity.
-- Additive only. Existing ordinary canonical IDs remain unchanged.

ALTER TABLE asian_baseball_games
  ADD COLUMN game_number INTEGER NOT NULL DEFAULT 0;

ALTER TABLE asian_baseball_games
  ADD COLUMN canonical_identity_version TEXT NOT NULL DEFAULT 'v1';

CREATE UNIQUE INDEX IF NOT EXISTS idx_asian_baseball_game_instance
  ON asian_baseball_games(league,game_date,away_team_id,home_team_id,game_number);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0096_asian_baseball_doubleheader_identity',datetime('now'));
