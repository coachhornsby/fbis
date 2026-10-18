-- NFL multi-checkpoint immutable research publications.
-- Compact D1 metadata + R2 full evidence. Does not rewrite published_projections.
-- UNIQUE prevents overwrite of an earlier freeze for the same checkpoint.

CREATE TABLE IF NOT EXISTS nfl_research_publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  season INTEGER,
  week INTEGER,
  game_type TEXT,
  game_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  home_team TEXT,
  away_team TEXT,
  venue TEXT,
  neutral_site INTEGER NOT NULL DEFAULT 0,
  checkpoint TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  feature_contract_version TEXT,
  code_sha TEXT,
  model_artifact_hash TEXT,
  status TEXT NOT NULL,
  failure_reason TEXT,
  published_at TEXT NOT NULL,
  information_cutoff TEXT,
  hours_to_start REAL,
  proj_home REAL,
  proj_away REAL,
  proj_margin REAL,
  proj_total REAL,
  p_home_win REAL,
  sigma_margin REAL,
  sigma_total REAL,
  coverage_share REAL,
  missing_features_json TEXT,
  input_checksum TEXT,
  output_checksum TEXT,
  payload_hash TEXT NOT NULL,
  compact_json TEXT NOT NULL,
  r2_key TEXT,
  reconstructability TEXT,
  score_reconciled INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  published_by TEXT NOT NULL DEFAULT 'nfl-pregame-publish',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, model_id, model_version, checkpoint)
);

CREATE INDEX IF NOT EXISTS idx_nfl_research_pubs_date
  ON nfl_research_publications (game_date, checkpoint, published_at);

CREATE INDEX IF NOT EXISTS idx_nfl_research_pubs_event
  ON nfl_research_publications (event_id, published_at);

CREATE INDEX IF NOT EXISTS idx_nfl_research_pubs_status
  ON nfl_research_publications (status, game_date);

-- Missed/blocked checkpoint ledger (explicit visibility; not a prediction).
CREATE TABLE IF NOT EXISTS nfl_research_publication_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT,
  game_date TEXT,
  checkpoint TEXT,
  status TEXT NOT NULL,
  detail TEXT,
  observed_at TEXT NOT NULL,
  code_sha TEXT,
  run_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_nfl_research_pub_events_date
  ON nfl_research_publication_events (game_date, observed_at);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0114_nfl_research_publications', datetime('now'));
