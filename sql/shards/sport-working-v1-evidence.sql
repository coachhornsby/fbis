-- Evidence materialization columns for sport working-set shards.
-- PRIMARY remains the canonical evidence store until an explicit cutover receipt.
-- payload_json holds the full primary-row envelope (fbis-canonical-evidence-v1).

ALTER TABLE prediction_snapshots ADD COLUMN proj_margin REAL;
ALTER TABLE prediction_snapshots ADD COLUMN p_market REAL;
ALTER TABLE prediction_snapshots ADD COLUMN weights_json TEXT;
ALTER TABLE prediction_snapshots ADD COLUMN layers_json TEXT;
ALTER TABLE prediction_snapshots ADD COLUMN projection_flags TEXT;
ALTER TABLE prediction_snapshots ADD COLUMN graded_at TEXT;
ALTER TABLE prediction_snapshots ADD COLUMN actual_home REAL;
ALTER TABLE prediction_snapshots ADD COLUMN actual_away REAL;
ALTER TABLE prediction_snapshots ADD COLUMN deployment_commit TEXT;

ALTER TABLE published_projections ADD COLUMN model_version TEXT;
ALTER TABLE published_projections ADD COLUMN published_by TEXT;
ALTER TABLE published_projections ADD COLUMN payload_hash TEXT;

INSERT OR REPLACE INTO fbis_topology_migrations(migration_id, applied_at, notes)
VALUES (
  'sport-working-v1-evidence',
  datetime('now'),
  'Canonical evidence materialization columns; primary remains authority'
);
