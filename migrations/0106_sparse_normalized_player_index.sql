-- Null player IDs cannot satisfy a lookup for a known canonical player.
-- Keep future player lookups indexed without indexing the entire game ledger.
DROP INDEX IF EXISTS idx_norm_market_player;
CREATE INDEX idx_norm_market_player
ON normalized_market_observations(sport,canonical_player_id,stat_family,collected_at)
WHERE canonical_player_id IS NOT NULL;
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES ('0106_sparse_normalized_player_index',datetime('now'));
