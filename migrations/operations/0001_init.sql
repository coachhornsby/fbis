-- Independent operational D1 schema bootstrap.
-- D1: fbis-operations-20261017 (OPERATIONS_DB).
-- Stores schema bookkeeping only; no existing primary D1 traffic is moved.
CREATE TABLE IF NOT EXISTS operations_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
