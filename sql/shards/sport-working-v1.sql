-- FBIS generic sport working-set schema (soccer / tennis / future sports).
-- Primary remains authority until SPORT_DB_MODE_<SPORT>=sport after parity passes.
-- Do not store unbounded WebSocket ticks here.

CREATE TABLE IF NOT EXISTS fbis_sport_shard_meta (
  key TEXT PRIMARY KEY,
  value_text TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  start TEXT,
  status TEXT,
  home_name TEXT,
  away_name TEXT,
  home_abbr TEXT,
  away_abbr TEXT,
  home_id TEXT,
  away_id TEXT,
  season TEXT,
  week INTEGER,
  venue TEXT,
  payload_json TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sport_games_start ON games(start);
CREATE INDEX IF NOT EXISTS idx_sport_games_sport_start ON games(sport, start);

CREATE TABLE IF NOT EXISTS prediction_snapshots (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  model_version TEXT,
  projection_kind TEXT,
  proj_total REAL,
  proj_home REAL,
  proj_away REAL,
  p_home_final REAL,
  frozen_at TEXT,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_sport_pred_game ON prediction_snapshots(game_id, frozen_at);

CREATE TABLE IF NOT EXISTS published_projections (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  published_at TEXT,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_sport_pub_game ON published_projections(game_id, published_at);

CREATE TABLE IF NOT EXISTS sport_parity_receipts (
  receipt_id TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL,
  table_name TEXT NOT NULL,
  primary_count INTEGER,
  sport_count INTEGER,
  matched INTEGER,
  status TEXT NOT NULL,
  detail_json TEXT
);

CREATE TABLE IF NOT EXISTS fbis_topology_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);
