-- Exhibition/all-star event sides can appear in ESPN's terminal-season team feed.
-- with FBS/FCS labels. Retain canonical identities/history but fail closed for active programs.
UPDATE cfb_canonical_teams
SET active = 0,
    updated_at = datetime('now')
WHERE active = 1
  AND COALESCE(json_extract(source_json,'$.is_exhibition'),0) = 1;

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0085_cfb_exhibition_active_gate',datetime('now'));
