-- Diagnostics-only normalization for pre-hardening canonical prospective evidence.
-- Preserve all source/provenance fields. Never make historical rows promotion-eligible.
UPDATE fbis_prospective_evidence
SET
  promotion_eligible = 0,
  promotion_exclusion_reasons_json = (
    SELECT json_group_array(reason)
    FROM (
      SELECT 'LEGACY_ROW' AS reason WHERE fbis_prospective_evidence.legacy = 1
      UNION ALL SELECT 'MISSING_EVENT_START' WHERE fbis_prospective_evidence.event_start_at IS NULL
      UNION ALL SELECT 'MISSING_GATE_VERSION' WHERE fbis_prospective_evidence.gate_version IS NULL
      UNION ALL SELECT 'MISSING_STATE_SNAPSHOT_ID' WHERE fbis_prospective_evidence.state_snapshot_id IS NULL
      UNION ALL SELECT 'MISSING_MARKET_SNAPSHOT_ID' WHERE fbis_prospective_evidence.market_snapshot_id IS NULL
      UNION ALL SELECT 'MISSING_MARKET_OBSERVED_AT' WHERE fbis_prospective_evidence.market_observed_at IS NULL
      UNION ALL SELECT 'MISSING_CODE_SHA' WHERE fbis_prospective_evidence.code_sha IS NULL
      UNION ALL SELECT 'MISSING_STATE_SNAPSHOT' WHERE fbis_prospective_evidence.state_snapshot_json IS NULL
      UNION ALL SELECT 'MISSING_MARKET_SNAPSHOT' WHERE fbis_prospective_evidence.market_snapshot_json IS NULL
      UNION ALL SELECT 'MISSING_UNCERTAINTY' WHERE fbis_prospective_evidence.uncertainty_json IS NULL
      UNION ALL SELECT 'MISSING_INCUMBENT_PROJECTION' WHERE fbis_prospective_evidence.incumbent_projection_json IS NULL
      UNION ALL SELECT 'MISSING_CHALLENGER_PROJECTION' WHERE fbis_prospective_evidence.challenger_projection_json IS NULL
      UNION ALL SELECT 'MISSING_QUALIFICATION_AUTHORITY' WHERE fbis_prospective_evidence.qualification_authority_json IS NULL
      UNION ALL SELECT 'MISSING_WAGER_AUTHORITY' WHERE fbis_prospective_evidence.wager_authority_json IS NULL
      UNION ALL SELECT 'MISSING_SOURCE_OBSERVATION_TIMES'
        WHERE fbis_prospective_evidence.source_observed_ats_json IS NULL
           OR json_array_length(fbis_prospective_evidence.source_observed_ats_json) = 0
    )
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
