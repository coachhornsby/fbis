-- Repair/guarantee model-learning evidence tables in canonical production D1.
-- Safe additive migration; tables may already exist in some environments.

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

CREATE INDEX IF NOT EXISTS idx_model_validation_runs_model_method
  ON model_validation_runs (model_id, method, created_at);

CREATE TABLE IF NOT EXISTS model_learning_findings (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  model_id TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  slice_key TEXT,
  metric TEXT NOT NULL,
  baseline_n INTEGER,
  recent_n INTEGER,
  baseline_value REAL,
  recent_value REAL,
  delta REAL,
  severity TEXT NOT NULL,
  window_start TEXT,
  window_end TEXT,
  evidence_json TEXT NOT NULL,
  hypothesis TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_learning_findings_model
  ON model_learning_findings (sport, model_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_model_learning_findings_severity
  ON model_learning_findings (severity, created_at);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0031_learning_evidence_tables', datetime('now'));
