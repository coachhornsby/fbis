-- Timeout-safe Heritage x PitchAPI soccer coverage and backfill control.
CREATE TABLE IF NOT EXISTS soccer_competition_coverage (
  heritage_name TEXT PRIMARY KEY,
  heritage_key TEXT,
  offering_tier TEXT NOT NULL DEFAULT 'DISCOVERY',
  model_eligible INTEGER,
  policy_reason TEXT,
  pitch_league_id TEXT,
  pitch_league_name TEXT,
  pitch_country_code TEXT,
  match_score REAL,
  match_method TEXT,
  seasons_json TEXT,
  current_season TEXT,
  pitch_match_count INTEGER NOT NULL DEFAULT 0,
  advanced_rows INTEGER NOT NULL DEFAULT 0,
  advanced_coverage REAL,
  history_start TEXT,
  history_end TEXT,
  discovery_status TEXT NOT NULL DEFAULT 'PENDING',
  validation_status TEXT NOT NULL DEFAULT 'NOT_RUN',
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  last_discovered_at TEXT,
  last_ingested_at TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_soccer_coverage_status
  ON soccer_competition_coverage(discovery_status,offering_tier,heritage_name);
CREATE INDEX IF NOT EXISTS idx_soccer_coverage_pitch
  ON soccer_competition_coverage(pitch_league_id);

CREATE TABLE IF NOT EXISTS soccer_pitchapi_backfill_queue (
  id TEXT PRIMARY KEY,
  heritage_name TEXT NOT NULL,
  heritage_key TEXT,
  pitch_league_id TEXT NOT NULL,
  season TEXT NOT NULL,
  offset INTEGER NOT NULL DEFAULT 0,
  page_size INTEGER NOT NULL DEFAULT 8,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  matches_seen INTEGER NOT NULL DEFAULT 0,
  matches_persisted INTEGER NOT NULL DEFAULT 0,
  analytics_unavailable INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(pitch_league_id,season,offset)
);
CREATE INDEX IF NOT EXISTS idx_soccer_backfill_queue_status
  ON soccer_pitchapi_backfill_queue(status,updated_at);
CREATE INDEX IF NOT EXISTS idx_soccer_backfill_queue_league
  ON soccer_pitchapi_backfill_queue(pitch_league_id,season,offset);

CREATE TABLE IF NOT EXISTS soccer_pitchapi_discovery_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  heritage_offerings INTEGER NOT NULL DEFAULT 0,
  pitch_leagues INTEGER NOT NULL DEFAULT 0,
  exact_matches INTEGER NOT NULL DEFAULT 0,
  fuzzy_matches INTEGER NOT NULL DEFAULT 0,
  unmatched INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT
);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0059_soccer_heritage_pitchapi_coverage',datetime('now'));
