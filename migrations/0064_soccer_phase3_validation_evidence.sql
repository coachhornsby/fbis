-- Soccer Phase 3 research validation evidence ledger.
-- Stores historical/prospective evidence only. It cannot qualify or authorize wagers.

CREATE TABLE IF NOT EXISTS soccer_validation_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  heritage_key TEXT,
  model_version TEXT NOT NULL,
  model_variant TEXT NOT NULL,
  benchmark_variant TEXT,
  market_family TEXT NOT NULL,
  line_key TEXT,
  sample_n INTEGER NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL,
  point_in_time INTEGER NOT NULL DEFAULT 1,
  market_used INTEGER NOT NULL DEFAULT 0,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  evaluated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id,heritage_key,model_variant,market_family,line_key)
);
CREATE INDEX IF NOT EXISTS idx_soccer_validation_evidence_lookup
  ON soccer_validation_evidence(heritage_key,model_version,market_family,evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_soccer_validation_evidence_run
  ON soccer_validation_evidence(run_id,model_variant);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0064_soccer_phase3_validation_evidence',datetime('now'));
