-- FBIS research integrity + HFA shadow storage.
-- Versioned. Tracked in schema_migrations. Do not use schema.sql CREATE TABLE IF NOT EXISTS to add columns.

ALTER TABLE strategy_tickets ADD COLUMN provenance TEXT;
ALTER TABLE strategy_tickets ADD COLUMN execution_book TEXT;
ALTER TABLE strategy_tickets ADD COLUMN benchmark_book TEXT;
ALTER TABLE strategy_tickets ADD COLUMN clv_version TEXT;

ALTER TABLE prediction_snapshots ADD COLUMN deployment_commit TEXT;

ALTER TABLE job_runs ADD COLUMN projections_generated INTEGER;
ALTER TABLE job_runs ADD COLUMN writes_already INTEGER;
ALTER TABLE job_runs ADD COLUMN immutable_conflicts INTEGER;
ALTER TABLE job_runs ADD COLUMN finals_awaiting_retry INTEGER;

CREATE TABLE IF NOT EXISTS harvest_retry_queue (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  date TEXT NOT NULL,
  game_id TEXT,
  reason TEXT,
  attempts INTEGER DEFAULT 0,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL,
  status TEXT DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS idx_harvest_retry_open ON harvest_retry_queue (status, sport, date);

CREATE TABLE IF NOT EXISTS write_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id TEXT,
  reason TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cfb_hfa_external (
  source TEXT NOT NULL,
  rating_year INTEGER NOT NULL,
  team_key TEXT NOT NULL,
  team_name TEXT,
  conference TEXT,
  raw_hfa REAL,
  smooth_hfa REAL,
  supplied_date TEXT,
  methodology TEXT,
  limitations TEXT,
  benchmark_only INTEGER DEFAULT 1,
  PRIMARY KEY (source, rating_year, team_key)
);

CREATE TABLE IF NOT EXISTS cfb_hfa_games (
  game_id TEXT PRIMARY KEY,
  season INTEGER,
  week INTEGER,
  kickoff TEXT,
  home_team_key TEXT,
  away_team_key TEXT,
  home_score REAL,
  away_score REAL,
  venue TEXT,
  neutral INTEGER,
  postseason INTEGER,
  conference_game INTEGER,
  overtime INTEGER,
  fbs_vs_fbs INTEGER,
  closing_spread REAL,
  closing_source TEXT,
  closing_at TEXT,
  source TEXT,
  source_ts TEXT
);

CREATE INDEX IF NOT EXISTS idx_hfa_games_season ON cfb_hfa_games (season, neutral, fbs_vs_fbs);

CREATE TABLE IF NOT EXISTS cfb_hfa_ratings (
  method TEXT NOT NULL,
  as_of_season INTEGER NOT NULL,
  team_key TEXT NOT NULL,
  national_baseline REAL,
  raw_hfa REAL,
  shrunken_hfa REAL,
  uncertainty REAL,
  games_used INTEGER,
  home_n INTEGER,
  road_n INTEGER,
  seasons_used INTEGER,
  n_eff REAL,
  reliability REAL,
  recency TEXT,
  method_version TEXT,
  available INTEGER,
  flags_json TEXT,
  updated_at TEXT,
  PRIMARY KEY (method, as_of_season, team_key)
);

CREATE VIEW IF NOT EXISTS pipeline_runs AS SELECT * FROM job_runs;

INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0005_hfa_and_integrity', datetime('now'));
