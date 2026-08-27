-- FBIS research integrity migration 0001
-- Versioned. Tracked in schema_migrations. Do not rely on schema.sql CREATE TABLE IF NOT EXISTS for column adds.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  trigger_type TEXT,
  started_at TEXT,
  completed_at TEXT,
  status TEXT,
  sport TEXT,
  dates_json TEXT,
  games_discovered INTEGER,
  writes_attempted INTEGER,
  writes_succeeded INTEGER,
  writes_failed INTEGER,
  finals_discovered INTEGER,
  finals_graded INTEGER,
  error_summary TEXT,
  deployment_commit TEXT,
  model_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_runs_type_time ON job_runs (job_type, started_at);
CREATE INDEX IF NOT EXISTS idx_strategy_tickets_role ON strategy_tickets (strategy_id, role, date);
