-- FBIS operational control plane.
-- Adds canonical component/SLA registry, current health ledger, run manifests,
-- reconciliation invariant results, and watchdog recovery metrics.

CREATE TABLE IF NOT EXISTS fbis_ops_components (
  component_id TEXT PRIMARY KEY,
  component_name TEXT NOT NULL,
  component_type TEXT NOT NULL,
  sport_or_domain TEXT,
  provider TEXT,
  criticality TEXT NOT NULL DEFAULT 'standard',
  expected_cadence_minutes INTEGER,
  grace_period_minutes INTEGER,
  stale_after_minutes INTEGER,
  escalation_after_minutes INTEGER,
  paid_provider INTEGER NOT NULL DEFAULT 0,
  health_endpoint TEXT,
  target_table TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fbis_ops_health (
  component_id TEXT PRIMARY KEY,
  workflow_freshness_at TEXT,
  source_freshness_at TEXT,
  database_freshness_at TEXT,
  published_freshness_at TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_nonempty_at TEXT,
  last_persist_at TEXT,
  last_verified_at TEXT,
  source_rows INTEGER,
  rows_written INTEGER,
  rows_visible_downstream INTEGER,
  status TEXT NOT NULL DEFAULT 'UNKNOWN',
  severity TEXT NOT NULL DEFAULT 'INFO',
  incident_fingerprint TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_empty_successes INTEGER NOT NULL DEFAULT 0,
  last_error_class TEXT,
  last_error TEXT,
  provider_run_id TEXT,
  workflow_run_id TEXT,
  deployment_sha TEXT,
  data_date_or_range TEXT,
  cost_or_quota_state TEXT,
  metadata_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(component_id) REFERENCES fbis_ops_components(component_id)
);
CREATE INDEX IF NOT EXISTS idx_fbis_ops_health_status ON fbis_ops_health(severity, status, updated_at);

CREATE TABLE IF NOT EXISTS fbis_run_manifests (
  run_id TEXT PRIMARY KEY,
  component_id TEXT NOT NULL,
  workflow_run_id TEXT,
  provider_run_id TEXT,
  trigger_type TEXT,
  expected_range TEXT,
  expected_items INTEGER,
  received_items INTEGER,
  persisted_items INTEGER,
  visible_items INTEGER,
  rejected_items INTEGER,
  duplicate_items INTEGER,
  started_at TEXT,
  finished_at TEXT,
  status TEXT NOT NULL,
  error_class TEXT,
  error_summary TEXT,
  deployment_sha TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(component_id) REFERENCES fbis_ops_components(component_id)
);
CREATE INDEX IF NOT EXISTS idx_fbis_run_manifests_component_time
  ON fbis_run_manifests(component_id, started_at DESC);

CREATE TABLE IF NOT EXISTS fbis_ops_invariant_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invariant_key TEXT NOT NULL,
  component_id TEXT,
  checked_at TEXT NOT NULL,
  status TEXT NOT NULL,
  expected_value TEXT,
  actual_value TEXT,
  detail TEXT,
  incident_fingerprint TEXT,
  metadata_json TEXT,
  FOREIGN KEY(component_id) REFERENCES fbis_ops_components(component_id)
);
CREATE INDEX IF NOT EXISTS idx_fbis_ops_invariants_key_time
  ON fbis_ops_invariant_checks(invariant_key, checked_at DESC);

CREATE TABLE IF NOT EXISTS fbis_watchdog_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_fingerprint TEXT NOT NULL,
  component_id TEXT,
  failure_class TEXT,
  severity TEXT,
  detected_at TEXT NOT NULL,
  repaired_at TEXT,
  verified_at TEXT,
  detection_source TEXT,
  autonomous_repair INTEGER NOT NULL DEFAULT 0,
  owner_action_required INTEGER NOT NULL DEFAULT 0,
  repeat_count INTEGER NOT NULL DEFAULT 1,
  mttr_seconds INTEGER,
  notes TEXT,
  UNIQUE(incident_fingerprint, detected_at),
  FOREIGN KEY(component_id) REFERENCES fbis_ops_components(component_id)
);
CREATE INDEX IF NOT EXISTS idx_fbis_watchdog_metrics_component
  ON fbis_watchdog_metrics(component_id, detected_at DESC);

-- Canonical components. These are operational defaults and may be refined
-- from repository configuration as workflows evolve.
INSERT OR IGNORE INTO fbis_ops_components
(component_id, component_name, component_type, sport_or_domain, provider, criticality,
 expected_cadence_minutes, grace_period_minutes, stale_after_minutes, escalation_after_minutes,
 paid_provider, health_endpoint, target_table, config_json)
VALUES
('cloudflare-production', 'Cloudflare production', 'deployment', 'platform', 'cloudflare', 'critical',
 60, 15, 90, 120, 0, '/api/health', NULL, '{"layeredFreshness":true}'),
('github-schedules', 'GitHub scheduled workflows', 'scheduler', 'platform', 'github', 'critical',
 60, 20, 120, 180, 0, NULL, NULL, '{"detectMissingRuns":true,"detectScheduleDrift":true}'),
('zen-action-daily', 'Zen ACTION daily full slate', 'ingestion', 'markets', 'zen-action', 'critical',
 1440, 60, 1620, 1800, 1, '/api/action-daily-status', 'action_daily_snapshots', '{"reuseProviderRun":true,"noDuplicatePaidRun":true}'),
('zen-prizepicks', 'Zen PrizePicks acquisition', 'ingestion', 'props', 'zen-prizepicks', 'critical',
 240, 30, 360, 480, 1, NULL, 'prizepicks_prop_lines', '{"noDuplicatePaidRun":true}'),
('score-settlement', 'Scores and settlement', 'settlement', 'all', 'official-score-sources', 'critical',
 60, 30, 180, 240, 0, NULL, 'prediction_snapshots', '{"requiresTrustedFinal":true}'),
('projection-publication', 'Projection publication', 'projection', 'all', 'fbis', 'critical',
 240, 30, 360, 480, 0, '/api/published-projections', 'published_projections', '{"preserveFrozenSnapshots":true}'),
('historical-backfills', 'Historical backfills', 'backfill', 'all', 'fbis', 'standard',
 NULL, NULL, NULL, NULL, 0, NULL, NULL, '{"completionSla":true}');

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0037_ops_control_plane', datetime('now'));
