-- Operational work runs live only in OPERATIONS_DB. No primary/cold-market traffic cutover.
CREATE TABLE IF NOT EXISTS operations_job_runs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_operations_job_runs_type_status_updated
ON operations_job_runs(job_type,status,updated_at);
CREATE INDEX IF NOT EXISTS idx_operations_job_runs_updated
ON operations_job_runs(updated_at);
