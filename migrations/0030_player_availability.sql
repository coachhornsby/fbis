-- Player availability / injury observations.
-- Licensed feeds (for example Two Deep) and approved official-source adapters
-- normalize into this table. Historical observations remain immutable evidence.

CREATE TABLE IF NOT EXISTS player_availability_observations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  sport TEXT NOT NULL,
  team_key TEXT NOT NULL,
  team_name TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  position TEXT,
  position_group TEXT,
  depth_rank INTEGER,
  status TEXT NOT NULL,
  practice_status TEXT,
  injury_detail TEXT,
  game_id TEXT,
  opponent_key TEXT,
  effective_from TEXT,
  source_updated_at TEXT,
  observed_at TEXT NOT NULL,
  source_url TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_availability_sport_team_time
  ON player_availability_observations (sport, team_key, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_availability_sport_player_time
  ON player_availability_observations (sport, player_name, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_availability_game
  ON player_availability_observations (game_id, observed_at DESC);


INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0030_player_availability', datetime('now'));
