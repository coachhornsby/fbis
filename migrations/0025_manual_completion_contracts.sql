-- Manual-completion contracts (append-only).
-- Does NOT mutate champion coefficients, historical projections, or wager gates.
-- ACTION remains market-intelligence only.

CREATE TABLE IF NOT EXISTS canonical_publication_ledger (
  publication_id TEXT PRIMARY KEY,
  projection_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT,
  sport TEXT,
  event_id TEXT,
  market_snapshot_id TEXT,
  published_value_json TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT 'internal',
  validation_status TEXT,
  publication_status TEXT NOT NULL,
  commercial_status TEXT,
  supersedes_publication_id TEXT,
  published_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canonical_publication_projection
  ON canonical_publication_ledger (projection_id, published_at);

CREATE INDEX IF NOT EXISTS idx_canonical_publication_sport_status
  ON canonical_publication_ledger (sport, publication_status, published_at);

CREATE TABLE IF NOT EXISTS canonical_dq_findings (
  id TEXT PRIMARY KEY,
  reason_code TEXT NOT NULL,
  severity TEXT NOT NULL,
  sport TEXT,
  event_id TEXT,
  player_id TEXT,
  market_type TEXT,
  message TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canonical_dq_severity
  ON canonical_dq_findings (severity, sport, created_at);

CREATE TABLE IF NOT EXISTS canonical_probability_provenance (
  id TEXT PRIMARY KEY,
  projection_id TEXT,
  probability_source TEXT NOT NULL,
  model_family TEXT,
  model_id TEXT,
  model_version TEXT,
  distribution_model_id TEXT,
  distribution_model_version TEXT,
  calibrator_id TEXT,
  calibrator_version TEXT,
  validation_status TEXT,
  oos_sample_size INTEGER,
  information_cutoff TEXT,
  generated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canonical_prob_proj
  ON canonical_probability_provenance (projection_id, generated_at);

CREATE TABLE IF NOT EXISTS canonical_promotion_evidence (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  artifact_ref TEXT,
  artifact_content_hash TEXT,
  training_hash TEXT,
  feature_manifest_id TEXT,
  fold_scheme TEXT,
  oos_n INTEGER,
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL,
  operator_decision TEXT,
  auto_promote INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canonical_promotion_model
  ON canonical_promotion_evidence (model_id, model_version, created_at);

CREATE TABLE IF NOT EXISTS canonical_runtime_version (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR REPLACE INTO canonical_runtime_version (key, value, updated_at)
VALUES
  ('platform_runtime_version', 'FBIS-v1.4', datetime('now')),
  ('cfb_champion_model_id', 'CFB-FBIS-v2', datetime('now')),
  ('mlb_champion_model_id', 'MLB-SAVANT-RPG-SP', datetime('now')),
  ('auto_promote_allowed', 'false', datetime('now')),
  ('action_can_qualify', 'false', datetime('now')),
  ('action_can_authorize', 'false', datetime('now')),
  ('version_cutover_rule', 'Never rewrite historical model_version stamps', datetime('now'));

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0025_manual_completion_contracts', datetime('now'));
