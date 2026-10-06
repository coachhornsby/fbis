CREATE TABLE IF NOT EXISTS soccer_competition_validation (
  id TEXT PRIMARY KEY,
  heritage_name TEXT NOT NULL,
  heritage_key TEXT NOT NULL,
  model_version TEXT NOT NULL,
  sample_n INTEGER NOT NULL DEFAULT 0,
  v2_accuracy REAL,
  v2_brier REAL,
  v2_log_loss REAL,
  v3_accuracy REAL,
  v3_brier REAL,
  v3_log_loss REAL,
  delta_accuracy REAL,
  delta_brier REAL,
  delta_log_loss REAL,
  advanced_coverage REAL,
  historical_gate TEXT NOT NULL DEFAULT 'NOT_RUN',
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  evaluated_at TEXT NOT NULL,
  meta_json TEXT,
  UNIQUE(heritage_key,model_version)
);
CREATE INDEX IF NOT EXISTS idx_soccer_comp_validation_gate
  ON soccer_competition_validation(historical_gate,sample_n);

ALTER TABLE soccer_competition_coverage ADD COLUMN last_validation_at TEXT;
ALTER TABLE soccer_competition_coverage ADD COLUMN validation_n INTEGER NOT NULL DEFAULT 0;
ALTER TABLE soccer_competition_coverage ADD COLUMN validation_brier REAL;
ALTER TABLE soccer_competition_coverage ADD COLUMN validation_log_loss REAL;
ALTER TABLE soccer_competition_coverage ADD COLUMN validation_accuracy REAL;

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0061_soccer_competition_validation',datetime('now'));
