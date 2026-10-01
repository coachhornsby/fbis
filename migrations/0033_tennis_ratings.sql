-- Tennis independent Elo/surface research ratings (0033).
CREATE TABLE IF NOT EXISTS tennis_ratings (
  player_key TEXT NOT NULL,
  tour TEXT NOT NULL,
  player_name TEXT NOT NULL,
  overall_rating REAL NOT NULL,
  hard_rating REAL,
  clay_rating REAL,
  grass_rating REAL,
  matches INTEGER NOT NULL DEFAULT 0,
  hard_matches INTEGER NOT NULL DEFAULT 0,
  clay_matches INTEGER NOT NULL DEFAULT 0,
  grass_matches INTEGER NOT NULL DEFAULT 0,
  last_match_date TEXT,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (player_key, tour)
);
CREATE INDEX IF NOT EXISTS idx_tennis_ratings_tour_rating
  ON tennis_ratings (tour, overall_rating DESC);
INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0033_tennis_ratings', datetime('now'));
