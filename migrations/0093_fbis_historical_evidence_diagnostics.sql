-- Diagnostics-only normalization for pre-hardening canonical prospective evidence.
-- Preserve all source/provenance fields. Never make historical rows promotion-eligible.
UPDATE fbis_prospective_evidence
SET
  promotion_eligible = 0,
  promotion_exclusion_reasons_json = (
    SELECT json_group_array(value)
    FROM json_each(json_array(
      CASE WHEN fbis_prospective_evidence.legacy = 1 THEN 'LEGACY_ROW' END,
      CASE WHEN fbis_prospective_evidence.event_start_at IS NULL THEN 'MISSING_EVENT_START' END,
      CASE WHEN fbis_prospective_evidence.gate_version IS NULL THEN 'MISSING_GATE_VERSION' END,
      CASE WHEN fbis_prospective_evidence.state_snapshot_id IS NULL THEN 'MISSING_STATE_SNAPSHOT_ID' END,
      CASE WHEN fbis_prospective_evidence.market_snapshot_id IS NULL THEN 'MISSING_MARKET_SNAPSHOT_ID' END,
      CASE WHEN fbis_prospective_evidence.market_observed_at IS NULL THEN 'MISSING_MARKET_OBSERVED_AT' END,
      CASE WHEN fbis_prospective_evidence.code_sha IS NULL THEN 'MISSING_CODE_SHA' END,
      CASE WHEN fbis_prospective_evidence.state_snapshot_json IS NULL THEN 'MISSING_STATE_SNAPSHOT' END,
      CASE WHEN fbis_prospective_evidence.market_snapshot_json IS NULL THEN 'MISSING_MARKET_SNAPSHOT' END,
      CASE WHEN fbis_prospective_evidence.uncertainty_json IS NULL THEN 'MISSING_UNCERTAINTY' END,
      CASE WHEN fbis_prospective_evidence.incumbent_projection_json IS NULL THEN 'MISSING_INCUMBENT_PROJECTION' END,
      CASE WHEN fbis_prospective_evidence.challenger_projection_json IS NULL THEN 'MISSING_CHALLENGER_PROJECTION' END,
      CASE WHEN fbis_prospective_evidence.qualification_authority_json IS NULL THEN 'MISSING_QUALIFICATION_AUTHORITY' END,
      CASE WHEN fbis_prospective_evidence.wager_authority_json IS NULL THEN 'MISSING_WAGER_AUTHORITY' END,
      CASE WHEN fbis_prospective_evidence.source_observed_ats_json IS NULL OR json_array_length(fbis_prospective_evidence.source_observed_ats_json)=0 THEN 'MISSING_SOURCE_OBSERVATION_TIMES' END
    ))
    WHERE value IS NOT NULL
  )
WHERE promotion_eligible = 0
  AND promotion_exclusion_reasons_json IS NULL
  AND (
    legacy = 1
    OR event_start_at IS NULL
    OR gate_version IS NULL
    OR state_snapshot_id IS NULL
    OR market_snapshot_id IS NULL
    OR market_observed_at IS NULL
    OR code_sha IS NULL
    OR state_snapshot_json IS NULL
    OR market_snapshot_json IS NULL
    OR uncertainty_json IS NULL
    OR incumbent_projection_json IS NULL
    OR challenger_projection_json IS NULL
    OR qualification_authority_json IS NULL
    OR wager_authority_json IS NULL
    OR source_observed_ats_json IS NULL
    OR json_array_length(source_observed_ats_json) = 0
  );

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0093_fbis_historical_evidence_diagnostics',datetime('now'));
