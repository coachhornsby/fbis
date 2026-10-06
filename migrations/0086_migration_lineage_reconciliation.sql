-- Reconcile FBIS application migration ledger with Wrangler's proven production ledger.
-- Forward-only bookkeeping repair: no schema/data objects are dropped or rewritten.
-- These five migration filenames are present in production d1_migrations but their
-- application IDs are absent from schema_migrations.
INSERT OR IGNORE INTO schema_migrations(id,applied_at) VALUES
  ('0009_college_research',datetime('now')),
  ('0010_mlb_market_projections',datetime('now')),
  ('0011_transfer_qb_history',datetime('now')),
  ('0043_nhl_wager_confidence_runs',datetime('now')),
  ('0078_cfb_subdivision_normalization',datetime('now'));

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0086_migration_lineage_reconciliation',datetime('now'));
