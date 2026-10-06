-- Distinguish market offers from independent MLB model-observation units.
-- Multiple PrizePicks tiers/lines may share the same underlying player projection.

ALTER TABLE mlb_prop_prospective_evidence ADD COLUMN projection_unit_key TEXT;

UPDATE mlb_prop_prospective_evidence
SET projection_unit_key =
  event_id || '|' ||
  COALESCE(NULLIF(player_id,''), lower(player_name)) || '|' ||
  market || '|' ||
  model_version || '|' ||
  checkpoint
WHERE projection_unit_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_mlb_prop_evidence_projection_unit
  ON mlb_prop_prospective_evidence (projection_unit_key, event_date, settled_at);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0072_mlb_prop_independent_unit',datetime('now'));
