-- FBIS continuous learning governance tiers 1-5.
-- Tier 5 is shadow-only by contract. No table in this migration grants wager authority.

CREATE TABLE IF NOT EXISTS learning_monitor_runs (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  model_id TEXT NOT NULL,
  observed_n INTEGER NOT NULL,
  recent_n INTEGER NOT NULL,
  metrics_json TEXT NOT NULL,
  drift_json TEXT,
  alerts_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_monitor_sport_model
  ON learning_monitor_runs (sport, model_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recalibration_runs (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  model_id TEXT NOT NULL,
  method TEXT NOT NULL,
  train_n INTEGER NOT NULL,
  holdout_n INTEGER NOT NULL,
  total_n INTEGER NOT NULL,
  last_observed_at TEXT,
  params_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recalibration_sport_model
  ON recalibration_runs (sport, model_id, created_at DESC);

CREATE TABLE IF NOT EXISTS challenger_evaluations (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  champion_model_id TEXT NOT NULL,
  challenger_id TEXT NOT NULL,
  paired_n INTEGER NOT NULL,
  gate_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  eligible_for_manual_promotion INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenger_sport_model
  ON challenger_evaluations (sport, champion_model_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bayesian_learning_state (
  sport TEXT NOT NULL,
  model_id TEXT NOT NULL,
  target TEXT NOT NULL,
  observed_n INTEGER NOT NULL,
  posterior_mean REAL,
  posterior_sd REAL,
  prior_mean REAL,
  prior_sd REAL,
  last_observed_at TEXT,
  metadata_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (sport, model_id, target)
);

CREATE TABLE IF NOT EXISTS online_learning_shadow (
  sport TEXT NOT NULL,
  model_id TEXT NOT NULL,
  weight REAL NOT NULL,
  score REAL,
  observed_n INTEGER NOT NULL,
  production_enabled INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (sport, model_id)
);

CREATE TABLE IF NOT EXISTS model_promotion_decisions (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  champion_model_id TEXT NOT NULL,
  challenger_id TEXT NOT NULL,
  challenger_evaluation_id TEXT,
  decision TEXT NOT NULL,
  operator TEXT,
  evidence_json TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS continuous_learning_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO fbis_ops_components
(component_id, component_name, component_type, sport_or_domain, provider, criticality,
 expected_cadence_minutes, grace_period_minutes, stale_after_minutes, escalation_after_minutes,
 paid_provider, health_endpoint, target_table, config_json)
VALUES
('continuous-learning-governance', 'Continuous learning governance', 'learning', 'all', 'fbis', 'standard',
 1440, 120, 1800, 2160, 0, '/api/continuous-learning', 'learning_monitor_runs',
 '{"sampleGated":true,"manualPromotion":true,"tier5ShadowOnly":true}');

INSERT OR REPLACE INTO continuous_learning_meta (key, value, updated_at) VALUES
  ('tier1_monitoring', 'enabled', datetime('now')),
  ('tier2_recalibration', 'sample_count_gated', datetime('now')),
  ('tier3_challenger', 'manual_promotion_required', datetime('now')),
  ('tier4_bayesian', 'advisory_shrinkage_only', datetime('now')),
  ('tier5_online', 'shadow_only_never_production', datetime('now')),
  ('auto_promote_allowed', 'false', datetime('now')),
  ('auto_wager_authority_allowed', 'false', datetime('now'));

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0038_continuous_learning_governance', datetime('now'));
