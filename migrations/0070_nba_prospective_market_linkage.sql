-- NBA Phase 3C prospective evaluation exclusions and market-link audit.
CREATE TABLE IF NOT EXISTS nba_prospective_exclusions (
  code_sha TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  excluded_at TEXT NOT NULL
);
INSERT OR IGNORE INTO nba_prospective_exclusions(code_sha,reason,excluded_at)
VALUES('00e02556d645d2d13352eaf9b644fc94603f23c1','INVALID_PHASE3_SMOKE_CONTROL_CONTEXT_AND_UNCALIBRATED_PROFILE',datetime('now'));

CREATE TABLE IF NOT EXISTS nba_prospective_market_links (
  id TEXT PRIMARY KEY,
  projection_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  prediction_timestamp TEXT NOT NULL,
  market_type TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_snapshot_rowid INTEGER,
  entry_line REAL,
  entry_price REAL,
  entry_no_vig REAL,
  entry_captured_at TEXT,
  close_snapshot_rowid INTEGER,
  close_line REAL,
  close_price REAL,
  close_no_vig REAL,
  close_captured_at TEXT,
  game_start TEXT,
  market_used_as_feature INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  linked_at TEXT NOT NULL,
  UNIQUE(projection_id,market_type,side)
);
CREATE INDEX IF NOT EXISTS idx_nba_prospective_market_links_game ON nba_prospective_market_links(game_id,prediction_timestamp);
CREATE INDEX IF NOT EXISTS idx_nba_prospective_market_links_projection ON nba_prospective_market_links(projection_id);
INSERT OR IGNORE INTO schema_migrations(id,applied_at) VALUES('0070_nba_prospective_market_linkage',datetime('now'));
