-- Canonical cross-sport evidence/state ledgers.
-- Additive only: sport-specific tables remain authoritative until explicitly migrated.

CREATE TABLE IF NOT EXISTS fbis_state_observations (
  observation_id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  state_family TEXT NOT NULL,
  state_value_json TEXT,
  source TEXT NOT NULL,
  evidence_class TEXT,
  evidence_rank REAL NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  expires_at TEXT,
  supersedes_observation_id TEXT,
  provenance_json TEXT,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fbis_state_observations_entity
  ON fbis_state_observations (sport, entity_type, entity_id, state_family, effective_at DESC);

CREATE TABLE IF NOT EXISTS fbis_prospective_evidence (
  evidence_id TEXT PRIMARY KEY,
  contract_version TEXT NOT NULL,
  sport TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_start_at TEXT,
  snapshot_at TEXT NOT NULL,
  champion_model_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT,
  lifecycle TEXT NOT NULL,
  gate_version TEXT,
  state_snapshot_id TEXT,
  market_snapshot_id TEXT,
  market_observed_at TEXT,
  code_sha TEXT,
  incumbent_projection_json TEXT,
  challenger_projection_json TEXT,
  governance_json TEXT,
  temporal_integrity INTEGER NOT NULL DEFAULT 0,
  legacy INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  graded_at TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fbis_prospective_evidence_cohort
  ON fbis_prospective_evidence (sport, model_id, gate_version, lifecycle, snapshot_at);

CREATE INDEX IF NOT EXISTS idx_fbis_prospective_evidence_event
  ON fbis_prospective_evidence (sport, event_id, snapshot_at);

CREATE TABLE IF NOT EXISTS fbis_economic_grades (
  grade_id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  sport TEXT NOT NULL,
  event_id TEXT NOT NULL,
  market_family TEXT NOT NULL,
  selection TEXT NOT NULL,
  projected_probability REAL,
  entry_line REAL,
  entry_price REAL,
  entry_no_vig_probability REAL,
  close_line REAL,
  close_price REAL,
  close_no_vig_probability REAL,
  result TEXT,
  clv_probability REAL,
  profit_units REAL,
  roi REAL,
  brier REAL,
  log_loss REAL,
  graded_at TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fbis_economic_grades_model_evidence
  ON fbis_economic_grades (sport, market_family, evidence_id);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0070_fbis_cross_sport_evidence',datetime('now'));
