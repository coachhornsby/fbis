-- NFL v1.3 personnel-aware RESEARCH snapshots. NFL_DB only.
-- Prognostic fields are immutable (INSERT OR IGNORE); grades are added later.
-- No authority flags can be set by this workflow.
CREATE TABLE IF NOT EXISTS nfl_personnel_shadow_predictions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  checkpoint TEXT NOT NULL CHECK (checkpoint IN ('EARLY','LATE')),
  model_id TEXT NOT NULL,
  kickoff TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  baseline_snapshot_id TEXT NOT NULL,
  baseline_frozen_at TEXT NOT NULL,
  home_abbr TEXT NOT NULL,
  away_abbr TEXT NOT NULL,
  baseline_home REAL NOT NULL,
  baseline_away REAL NOT NULL,
  baseline_margin REAL NOT NULL,
  baseline_total REAL NOT NULL,
  challenger_home REAL NOT NULL,
  challenger_away REAL NOT NULL,
  challenger_margin REAL NOT NULL,
  challenger_total REAL NOT NULL,
  severe_wr_home INTEGER NOT NULL DEFAULT 0,
  severe_wr_away INTEGER NOT NULL DEFAULT 0,
  source_evidence_json TEXT NOT NULL,
  can_qualify INTEGER NOT NULL DEFAULT 0 CHECK (can_qualify=0),
  can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK (can_authorize_wager=0),
  actual_home REAL,
  actual_away REAL,
  actual_margin REAL,
  actual_total REAL,
  baseline_margin_ae REAL,
  challenger_margin_ae REAL,
  baseline_total_ae REAL,
  challenger_total_ae REAL,
  graded_at TEXT,
  result_source TEXT,
  UNIQUE(event_id,model_id,checkpoint),
  CHECK (baseline_frozen_at<=captured_at AND captured_at<kickoff)
);
CREATE INDEX IF NOT EXISTS idx_nfl_personnel_shadow_pending
  ON nfl_personnel_shadow_predictions(graded_at,kickoff);
CREATE INDEX IF NOT EXISTS idx_nfl_personnel_shadow_cohorts
  ON nfl_personnel_shadow_predictions(checkpoint,severe_wr_home,severe_wr_away,graded_at);
