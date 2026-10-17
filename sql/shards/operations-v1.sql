-- FBIS operations D1 shard (independent database).
-- Preferred home for ops control plane, capacity alerts, retention gates,
-- pipeline validation receipts, and D1 performance findings.
-- No betting qualification authority.

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
CREATE INDEX IF NOT EXISTS idx_ops_health_status ON fbis_ops_health(severity, status, updated_at);

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
CREATE INDEX IF NOT EXISTS idx_ops_run_manifests_component_time
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
CREATE INDEX IF NOT EXISTS idx_ops_invariants_key_time
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
CREATE INDEX IF NOT EXISTS idx_ops_watchdog_component
  ON fbis_watchdog_metrics(component_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS fbis_capacity_measurements (
  measurement_id TEXT PRIMARY KEY,
  measured_at TEXT NOT NULL,
  database_key TEXT NOT NULL,
  database_id TEXT NOT NULL,
  database_name TEXT NOT NULL,
  used_bytes INTEGER NOT NULL,
  hard_limit_bytes INTEGER NOT NULL,
  percent_used REAL NOT NULL,
  alert_level TEXT NOT NULL,
  alert_80 INTEGER NOT NULL DEFAULT 0,
  alert_85 INTEGER NOT NULL DEFAULT 0,
  alert_90 INTEGER NOT NULL DEFAULT 0,
  evidence_sha256 TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ops_capacity_db_time
  ON fbis_capacity_measurements(database_key, measured_at DESC);

CREATE TABLE IF NOT EXISTS fbis_retention_release_gates (
  release_id TEXT PRIMARY KEY,
  cohort_key TEXT NOT NULL,
  source_database TEXT NOT NULL,
  proposed_at TEXT NOT NULL,
  r2_archive_verified INTEGER NOT NULL DEFAULT 0,
  r2_readback_sha256 TEXT,
  independent_restore_verified INTEGER NOT NULL DEFAULT 0,
  independent_restore_evidence TEXT,
  drive_copy_verified INTEGER NOT NULL DEFAULT 0,
  consumer_audit_complete INTEGER NOT NULL DEFAULT 0,
  retention_release_authorized INTEGER NOT NULL DEFAULT 0,
  source_rows_deleted INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  metadata_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ops_retention_cohort
  ON fbis_retention_release_gates(cohort_key, proposed_at DESC);

CREATE TABLE IF NOT EXISTS fbis_pipeline_validation_runs (
  run_id TEXT PRIMARY KEY,
  validated_at TEXT NOT NULL,
  sport TEXT NOT NULL,
  collection_ok INTEGER NOT NULL DEFAULT 0,
  projections_ok INTEGER NOT NULL DEFAULT 0,
  odds_ok INTEGER NOT NULL DEFAULT 0,
  model_updates_ok INTEGER NOT NULL DEFAULT 0,
  player_props_ok INTEGER NOT NULL DEFAULT 0,
  overall_ok INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT,
  deployment_sha TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ops_pipeline_sport_time
  ON fbis_pipeline_validation_runs(sport, validated_at DESC);

CREATE TABLE IF NOT EXISTS fbis_d1_performance_findings (
  finding_id TEXT PRIMARY KEY,
  recorded_at TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  table_name TEXT,
  index_name TEXT,
  detail TEXT NOT NULL,
  recommendation TEXT,
  estimated_d1_impact TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_ops_perf_status
  ON fbis_d1_performance_findings(status, severity, recorded_at DESC);

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
 NULL, NULL, NULL, NULL, 0, NULL, NULL, '{"completionSla":true}'),
('capacity-monitor', 'D1 capacity monitor', 'storage', 'platform', 'cloudflare', 'critical',
 1440, 60, 1800, 2160, 0, '/api/storage-capacity', 'fbis_capacity_measurements', '{"alerts":[80,85,90]}'),
('pipeline-validation', 'Cross-sport pipeline validation', 'validation', 'all', 'fbis', 'critical',
 1440, 120, 1800, 2160, 0, '/api/pipeline-validation', 'fbis_pipeline_validation_runs', '{"surfaces":["collection","projections","odds","models","props"]}');
