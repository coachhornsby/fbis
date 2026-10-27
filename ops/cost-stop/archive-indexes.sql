-- OFFLINE PREPARATION ONLY. Do not apply until index-build cost is approved.
-- Apply only to market-history partitions scheduled for a bounded archive pass.
CREATE INDEX IF NOT EXISTS idx_market_archive_cursor
ON normalized_market_observations(collected_at,id);
-- INDEXED BY in the archive query fails closed if this index is absent.
