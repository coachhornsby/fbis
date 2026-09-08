-- Additive schema extensions introduced after the original schema.sql baseline.
-- Fresh databases should apply migrations; this file keeps schema verification explicit.

CREATE TABLE IF NOT EXISTS published_projections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sport TEXT NOT NULL,
  game_id TEXT NOT NULL,
  game_date TEXT NOT NULL,
  start_time TEXT,
  model_version TEXT,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  published_by TEXT NOT NULL DEFAULT 'operator',
  UNIQUE (sport, game_id, model_version)
);

CREATE INDEX IF NOT EXISTS idx_published_projections_date
  ON published_projections (game_date, sport, published_at);
CREATE INDEX IF NOT EXISTS idx_published_projections_game
  ON published_projections (sport, game_id);
