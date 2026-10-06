-- Soccer Phase 3G prospective-shadow grading preparation.
-- Additive only; research-only ledger remains non-authoritative.

ALTER TABLE soccer_prospective_shadow ADD COLUMN v2_projection_value REAL;
ALTER TABLE soccer_prospective_shadow ADD COLUMN v31_projection_value REAL;
ALTER TABLE soccer_prospective_shadow ADD COLUMN v2_brier REAL;
ALTER TABLE soccer_prospective_shadow ADD COLUMN v31_brier REAL;
ALTER TABLE soccer_prospective_shadow ADD COLUMN v2_log_loss REAL;
ALTER TABLE soccer_prospective_shadow ADD COLUMN v31_log_loss REAL;
ALTER TABLE soccer_prospective_shadow ADD COLUMN v2_abs_error REAL;
ALTER TABLE soccer_prospective_shadow ADD COLUMN v31_abs_error REAL;

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0081_soccer_phase3g_shadow_grading_fields',datetime('now'));
