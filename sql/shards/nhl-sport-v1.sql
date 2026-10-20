-- FBIS NHL_DB sport working-set pilot.
-- Primary remains authority until NHL_SPORT_DB_MODE=sport after parity passes.
-- Do not store unbounded WebSocket ticks here.

CREATE TABLE IF NOT EXISTS fbis_sport_shard_meta (
  key TEXT PRIMARY KEY,
  value_text TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR REPLACE INTO fbis_sport_shard_meta(key, value_text) VALUES
 ('sport','nhl'),
 ('binding','NHL_DB'),
 ('pilot_status','SCHEMA_READY'),
 ('contract','fbis-sport-d1-v1');

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
CREATE INDEX IF NOT EXISTS idx_nhl_games_start ON games(start);

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
CREATE INDEX IF NOT EXISTS idx_nhl_pred_game ON prediction_snapshots(game_id, frozen_at);

CREATE TABLE IF NOT EXISTS published_projections (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  published_at TEXT,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_nhl_pub_game ON published_projections(game_id, published_at);

CREATE TABLE IF NOT EXISTS nhl_wager_decisions (
  decision_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  decided_at TEXT,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS nhl_wager_settlements (
  settlement_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  settled_at TEXT,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS nhl_goalie_probability_shadow (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  frozen_at TEXT,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS nhl_bookmaker_quote_evidence (
  id TEXT PRIMARY KEY,
  source_event_id TEXT,
  captured_at TEXT,
  bookmaker TEXT,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS nhl_parity_receipts (
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

INSERT OR IGNORE INTO fbis_topology_migrations(migration_id, notes)
VALUES ('nhl-sport-v1', 'NHL sport D1 pilot schema');
