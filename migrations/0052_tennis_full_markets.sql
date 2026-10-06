-- Expand tennis research market snapshots beyond moneyline.
-- ACTION remains market-intelligence only; these fields do not authorize wagers.

ALTER TABLE tennis_market_snapshots ADD COLUMN player1_line REAL;
ALTER TABLE tennis_market_snapshots ADD COLUMN player2_line REAL;
ALTER TABLE tennis_market_snapshots ADD COLUMN over_price REAL;
ALTER TABLE tennis_market_snapshots ADD COLUMN under_price REAL;
ALTER TABLE tennis_market_snapshots ADD COLUMN over_no_vig_prob REAL;
ALTER TABLE tennis_market_snapshots ADD COLUMN under_no_vig_prob REAL;
ALTER TABLE tennis_market_snapshots ADD COLUMN market_payload_json TEXT;

CREATE INDEX IF NOT EXISTS idx_tennis_market_event_type_time
  ON tennis_market_snapshots(canonical_event_id, market_type, observed_at);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0052_tennis_full_markets', datetime('now'));
