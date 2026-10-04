ALTER TABLE prizepicks_prop_lines ADD COLUMN role_confidence REAL;
ALTER TABLE prizepicks_prop_lines ADD COLUMN snap_share REAL;
ALTER TABLE prizepicks_prop_lines ADD COLUMN prop_gate TEXT;
ALTER TABLE prizepicks_prop_lines ADD COLUMN eligible_for_card INTEGER;
ALTER TABLE prizepicks_prop_lines ADD COLUMN feature_evidence_json TEXT;
ALTER TABLE prizepicks_prop_lines ADD COLUMN model_source TEXT;
ALTER TABLE prizepicks_prop_lines ADD COLUMN model_version TEXT;

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0046_nfl_prop_evidence', datetime('now'));
