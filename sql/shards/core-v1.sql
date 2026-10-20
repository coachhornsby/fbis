-- FBIS CORE_DB shard. Shared settings, model registry, bet index, dashboard summaries.
-- No sport working-set authority. No unbounded market ticks.

CREATE TABLE IF NOT EXISTS fbis_core_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS fbis_model_registry (
  model_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REGISTERED',
  artifact_r2_key TEXT,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata_json TEXT,
  PRIMARY KEY (model_id, sport, version)
);

CREATE TABLE IF NOT EXISTS fbis_dashboard_summaries (
  summary_key TEXT NOT NULL,
  as_of TEXT NOT NULL,
  sport TEXT,
  payload_json TEXT NOT NULL,
  source_binding TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (summary_key, as_of)
);

CREATE TABLE IF NOT EXISTS fbis_executed_bet_index (
  bet_id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  placed_at TEXT,
  settled_at TEXT,
  status TEXT,
  sport_db_binding TEXT,
  primary_row_ref TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fbis_topology_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);

INSERT OR IGNORE INTO fbis_topology_migrations(migration_id, notes)
VALUES ('core-v1', 'Initial CORE_DB shard');
