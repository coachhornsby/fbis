-- Projection state persisted on immutable snapshots. League-average CFB must remain labeled.

ALTER TABLE prediction_snapshots ADD COLUMN projection_state TEXT;
ALTER TABLE prediction_snapshots ADD COLUMN projection_kind TEXT;
ALTER TABLE prediction_snapshots ADD COLUMN projection_flags TEXT;
ALTER TABLE predictions ADD COLUMN projection_state TEXT;
ALTER TABLE predictions ADD COLUMN projection_kind TEXT;
