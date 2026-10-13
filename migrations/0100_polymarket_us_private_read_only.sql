-- Private Polymarket US account read-only evidence: no browser read endpoint.
-- Not the validated wager ledger. No automatic payouts or grade authority.
CREATE TABLE IF NOT EXISTS polymarket_us_private_activity (
 id TEXT PRIMARY KEY,
 activity_type TEXT NOT NULL,
 source_trade_id TEXT,
 market_slug TEXT,
 recorded_at TEXT,
 observed_at TEXT NOT NULL,
 price_usd REAL,
 quantity TEXT,
 cost_basis_usd REAL,
 realized_pnl_usd REAL,
 status TEXT,
 evidence_level TEXT NOT NULL DEFAULT 'PRIVATE_API_REPORT',
 can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0)
);
CREATE INDEX IF NOT EXISTS idx_pm_private_activity_time ON polymarket_us_private_activity(recorded_at,observed_at);
CREATE INDEX IF NOT EXISTS idx_pm_private_activity_market ON polymarket_us_private_activity(market_slug,observed_at);
CREATE TABLE IF NOT EXISTS polymarket_us_private_positions (
 id TEXT PRIMARY KEY,
 market_slug TEXT NOT NULL,
 net_quantity TEXT,
 cost_basis_usd REAL,
 realized_pnl_usd REAL,
 cash_value_usd REAL,
 expired INTEGER,
 observed_at TEXT NOT NULL,
 evidence_level TEXT NOT NULL DEFAULT 'PRIVATE_API_REPORT',
 can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0)
);
CREATE INDEX IF NOT EXISTS idx_pm_private_position_market_time ON polymarket_us_private_positions(market_slug,observed_at DESC);
CREATE TABLE IF NOT EXISTS polymarket_us_private_sync_runs (
 id TEXT PRIMARY KEY,
 captured_at TEXT NOT NULL,
 positions_count INTEGER NOT NULL DEFAULT 0,
 activities_count INTEGER NOT NULL DEFAULT 0,
 positions_complete INTEGER NOT NULL DEFAULT 0,
 activities_complete INTEGER NOT NULL DEFAULT 0,
 http_status INTEGER,
 status TEXT NOT NULL,
 source TEXT NOT NULL DEFAULT 'POLYMARKET_US_PRIVATE_READ_ONLY',
 can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0)
);
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES ('0100_polymarket_us_private_read_only',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
