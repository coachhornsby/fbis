-- Persist stake provenance for FBIS-ECONOMIC-GRADE-v1.
-- Additive only; historical rows remain NULL and must not be backfilled without evidence.
ALTER TABLE fbis_economic_grades ADD COLUMN stake_units REAL;

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0092_fbis_economic_grade_stake_provenance',datetime('now'));
