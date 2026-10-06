-- Reissue CFB subdivision normalization after 0078 was falsely marked applied.
-- Idempotent data repair: preserves identities and only normalizes persisted labels.
-- by legacy migration bookkeeping without executing its SQL.
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
VALUES('0083_cfb_subdivision_normalization_reissue',datetime('now'));
