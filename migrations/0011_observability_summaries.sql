-- Durable per-invocation evidence and compact SYS aggregates.

CREATE TABLE IF NOT EXISTS pipeline_stage_runs (
  id TEXT PRIMARY KEY,
  run_url TEXT,
  stage TEXT NOT NULL,
  sport TEXT NOT NULL,
  trigger_type TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  http_status INTEGER,
  error_summary TEXT,
  deployment_commit TEXT
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stage_latest
  ON pipeline_stage_runs (sport, stage, started_at DESC);

CREATE TABLE IF NOT EXISTS accuracy_daily_summary (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  date TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  model_version TEXT NOT NULL,
  projected_n INTEGER NOT NULL DEFAULT 0,
  graded_n INTEGER NOT NULL DEFAULT 0,
  abs_total_error_sum REAL NOT NULL DEFAULT 0,
  total_bias_sum REAL NOT NULL DEFAULT 0,
  winner_correct_n INTEGER NOT NULL DEFAULT 0,
  winner_graded_n INTEGER NOT NULL DEFAULT 0,
  brier_sum REAL NOT NULL DEFAULT 0,
  brier_n INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accuracy_summary_range
  ON accuracy_daily_summary (sport, date, checkpoint, model_version);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0011_observability_summaries', datetime('now'));
