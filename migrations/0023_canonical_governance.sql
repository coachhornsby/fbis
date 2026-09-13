-- Canonical governance foundations (Model Family Standard).
-- Additive only. Does NOT mutate champion coefficients or wager gates.
-- ACTION remains shadow. CFB-FBIS-v2 remains locked display champion.

CREATE TABLE IF NOT EXISTS canonical_source_registry (
  provider_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sports_json TEXT NOT NULL,
  domain TEXT NOT NULL,
  data_families_json TEXT NOT NULL,
  endpoint_or_feed TEXT,
  cadence TEXT,
  historical_coverage TEXT,
  commercial_status TEXT NOT NULL,
  priority INTEGER,
  fallback_priority INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  in_pure_model INTEGER NOT NULL DEFAULT 0,
  in_market_layer INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_model_registry (
  model_id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  family TEXT NOT NULL,
  display_name TEXT NOT NULL,
  maturity TEXT NOT NULL,
  role TEXT NOT NULL,
  artifact_ref TEXT,
  coefficients_locked INTEGER NOT NULL DEFAULT 0,
  calibration_locked INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  market_informed INTEGER NOT NULL DEFAULT 0,
  independent INTEGER NOT NULL DEFAULT 1,
  preserves_incumbent INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_feature_registry (
  feature_name TEXT NOT NULL,
  sport TEXT NOT NULL,
  model_family TEXT NOT NULL,
  provider_id TEXT,
  raw_field TEXT,
  normalized_field TEXT,
  transform_version TEXT,
  window TEXT,
  missing_rule TEXT,
  timestamp_rule TEXT,
  status TEXT NOT NULL,
  rationale TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (feature_name, sport, model_family)
);

CREATE TABLE IF NOT EXISTS canonical_provider_health (
  provider_id TEXT PRIMARY KEY,
  sport TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error_class TEXT,
  last_error_message TEXT,
  freshness_seconds INTEGER,
  coverage_ratio REAL,
  status TEXT NOT NULL DEFAULT 'UNKNOWN',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_misprice_snapshots (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  event_id TEXT,
  player_id TEXT,
  market_type TEXT NOT NULL,
  model_id TEXT,
  state TEXT NOT NULL,
  label TEXT NOT NULL,
  projection REAL,
  market_line REAL,
  disagreement_units REAL,
  model_probability REAL,
  expected_value REAL,
  can_show_ev INTEGER NOT NULL DEFAULT 0,
  information_cutoff TEXT,
  market_timestamp TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canonical_misprice_sport_state
  ON canonical_misprice_snapshots (sport, state, created_at);

CREATE INDEX IF NOT EXISTS idx_canonical_model_sport_maturity
  ON canonical_model_registry (sport, maturity);

CREATE TABLE IF NOT EXISTS canonical_governance_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR REPLACE INTO canonical_governance_meta (key, value, updated_at)
VALUES
  ('gap_report', 'docs/canonical/gap-report-2026-09-13.md', datetime('now')),
  ('auto_promote_allowed', 'false', datetime('now')),
  ('action_shadow_only', 'true', datetime('now')),
  ('cfb_champion_frozen', 'CFB-FBIS-v2', datetime('now')),
  ('mlb_champion_frozen', 'MLB-SAVANT-RPG-SP', datetime('now'));

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0023_canonical_governance', datetime('now'));
