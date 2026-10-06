-- MLB prospective prop evidence and bounded settlement ledger.
-- Frozen pregame evidence only. No automatic qualification or wager authority.

CREATE TABLE IF NOT EXISTS mlb_prop_prospective_evidence (
  id TEXT PRIMARY KEY,
  gate_version TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  event_start_at TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  opponent TEXT,
  position TEXT,
  market TEXT NOT NULL,
  projection REAL NOT NULL,
  sigma REAL,
  model_source TEXT NOT NULL,
  model_version TEXT NOT NULL,
  source_observed_at TEXT,
  state_as_of TEXT NOT NULL,
  projection_snapshot_at TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  market_source TEXT NOT NULL,
  sportsbook TEXT,
  market_line REAL NOT NULL,
  odds_tier TEXT,
  market_observed_at TEXT NOT NULL,
  decision_snapshot_at TEXT NOT NULL,
  candidate_side TEXT,
  state_snapshot_json TEXT NOT NULL,
  projection_json TEXT NOT NULL,
  market_json TEXT NOT NULL,
  temporal_integrity INTEGER NOT NULL DEFAULT 0,
  temporal_diagnostics_json TEXT,
  duplicate_key TEXT NOT NULL,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  actual_value REAL,
  result TEXT,
  settled_at TEXT,
  settlement_source TEXT,
  settlement_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mlb_prop_evidence_duplicate
  ON mlb_prop_prospective_evidence (duplicate_key);

CREATE INDEX IF NOT EXISTS idx_mlb_prop_evidence_market
  ON mlb_prop_prospective_evidence (market, model_version, event_date, projection_snapshot_at);

CREATE INDEX IF NOT EXISTS idx_mlb_prop_evidence_pending
  ON mlb_prop_prospective_evidence (event_date, event_id, settled_at, temporal_integrity);

CREATE TABLE IF NOT EXISTS mlb_prop_evidence_rejections (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  event_id TEXT,
  player_id TEXT,
  player_name TEXT,
  market TEXT,
  reason TEXT NOT NULL,
  details_json TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mlb_prop_evidence_rejections_date
  ON mlb_prop_evidence_rejections (observed_at, reason);

CREATE TABLE IF NOT EXISTS mlb_prop_evidence_runs (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  event_date TEXT,
  shard INTEGER,
  shards INTEGER,
  status TEXT NOT NULL,
  attempted INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0,
  missing_outcomes INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0071_mlb_prop_prospective_evidence',datetime('now'));
