-- Soccer Phase 3B validation provenance.
ALTER TABLE soccer_validation_evidence ADD COLUMN snapshot_id TEXT;
ALTER TABLE soccer_validation_evidence ADD COLUMN code_sha TEXT;
CREATE INDEX IF NOT EXISTS idx_soccer_validation_evidence_snapshot
  ON soccer_validation_evidence(snapshot_id,heritage_key,model_variant,market_family);
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0067_soccer_phase3b_validation_provenance',datetime('now'));
