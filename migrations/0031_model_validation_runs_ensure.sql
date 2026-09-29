-- Ensure the weekly auto-train validation artifact store exists in production D1.
-- Historical deployments applied an earlier version of 0009 before this table
-- was added to that migration, so a new additive migration is required.

CREATE TABLE IF NOT EXISTS model_validation_runs (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  method TEXT,
  train_until TEXT,
  validate_from TEXT,
  validate_until TEXT,
  n INTEGER,
  metrics_json TEXT,
  leakage_ok INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_validation_runs_model_created
  ON model_validation_runs (model_id, created_at DESC);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0031_model_validation_runs_ensure', datetime('now'));
