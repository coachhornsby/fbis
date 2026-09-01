-- Immutable EV anomaly audit trail (separate from frozen snapshots/tickets).

CREATE TABLE IF NOT EXISTS ev_audit_records (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  sport TEXT,
  market TEXT,
  side TEXT,
  model_version TEXT,
  qualification_rule_version TEXT,
  freeze_at TEXT,
  stored_ev REAL,
  recomputed_ev REAL,
  anomaly_reason TEXT NOT NULL,
  root_cause TEXT,
  qualified INTEGER,
  entered_strategy INTEGER,
  disposition TEXT NOT NULL,
  inputs_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ev_audit_entity ON ev_audit_records (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ev_audit_reason ON ev_audit_records (anomaly_reason, created_at);

INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0012_ev_audit_records', datetime('now'));
