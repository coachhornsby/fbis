-- FBIS prospective/economic provenance hardening.
-- Forward-only and additive. Existing evidence is preserved; rows without the
-- added provenance remain stored but fail closed for promotion-cohort use.

ALTER TABLE fbis_prospective_evidence ADD COLUMN source_observed_ats_json TEXT;
ALTER TABLE fbis_prospective_evidence ADD COLUMN state_snapshot_json TEXT;
ALTER TABLE fbis_prospective_evidence ADD COLUMN market_snapshot_json TEXT;
ALTER TABLE fbis_prospective_evidence ADD COLUMN uncertainty_json TEXT;
ALTER TABLE fbis_prospective_evidence ADD COLUMN temporal_diagnostics_json TEXT;
ALTER TABLE fbis_prospective_evidence ADD COLUMN qualification_authority_json TEXT;
ALTER TABLE fbis_prospective_evidence ADD COLUMN wager_authority_json TEXT;
ALTER TABLE fbis_prospective_evidence ADD COLUMN promotion_eligible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fbis_prospective_evidence ADD COLUMN promotion_exclusion_reasons_json TEXT;

ALTER TABLE fbis_economic_grades ADD COLUMN entry_market_snapshot_id TEXT;
ALTER TABLE fbis_economic_grades ADD COLUMN close_market_snapshot_id TEXT;
ALTER TABLE fbis_economic_grades ADD COLUMN entry_observed_at TEXT;
ALTER TABLE fbis_economic_grades ADD COLUMN close_observed_at TEXT;
ALTER TABLE fbis_economic_grades ADD COLUMN economic_basis TEXT;
ALTER TABLE fbis_economic_grades ADD COLUMN metric_method_version TEXT;

CREATE TABLE IF NOT EXISTS fbis_economic_cohort_metrics (
  cohort_id TEXT PRIMARY KEY,
  contract_version TEXT NOT NULL,
  sport TEXT NOT NULL,
  model_id TEXT NOT NULL,
  market_family TEXT NOT NULL,
  gate_version TEXT,
  window_start_at TEXT,
  window_end_at TEXT,
  observations_n INTEGER NOT NULL DEFAULT 0,
  brier_mean REAL,
  log_loss_mean REAL,
  clv_probability_mean REAL,
  profit_units REAL,
  roi REAL,
  calibration_value REAL,
  calibration_method_version TEXT,
  max_drawdown_units REAL,
  drawdown_method_version TEXT,
  evidence_filter_json TEXT,
  provenance_json TEXT,
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fbis_economic_cohort_lookup
  ON fbis_economic_cohort_metrics (sport, model_id, market_family, gate_version, generated_at);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0091_fbis_prospective_economic_provenance',datetime('now'));
