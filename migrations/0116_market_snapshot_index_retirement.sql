-- Reversible capacity relief: retain every immutable market row and both
-- identity constraints. Live readers use sport/event/time or source indexes.
-- No production query forces the retired snapshot/sport/time index.
DROP INDEX IF EXISTS idx_norm_market_snapshot;
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0116_market_snapshot_index_retirement',datetime('now'));
