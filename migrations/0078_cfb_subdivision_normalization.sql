-- Normalize CFB subdivision labels so the persisted production-universe contract is exact.
-- Targeted data repair only; no projection, qualification, HFA, or wager-authority changes.

UPDATE cfb_canonical_teams
SET subdivision = UPPER(TRIM(subdivision)),
    updated_at = datetime('now')
WHERE subdivision IS NOT NULL
  AND subdivision <> UPPER(TRIM(subdivision));

UPDATE cfb_conference_membership
SET subdivision = UPPER(TRIM(subdivision))
WHERE subdivision IS NOT NULL
  AND subdivision <> UPPER(TRIM(subdivision));

UPDATE cfb_team_identity_observations
SET subdivision = UPPER(TRIM(subdivision))
WHERE subdivision IS NOT NULL
  AND subdivision <> UPPER(TRIM(subdivision));

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0078_cfb_subdivision_normalization',datetime('now'));
