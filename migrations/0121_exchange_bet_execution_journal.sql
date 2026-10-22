-- Read-only imported exchange executions; never infer a wagering recommendation from account trades.
-- Independent table prevents account credentials, orders, and funding details entering public betting feeds.
CREATE TABLE IF NOT EXISTS exchange_bet_fills (
  provider TEXT NOT NULL CHECK(provider IN ('Kalshi','Polymarket US')),
  fill_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  market TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('YES','NO','UNKNOWN')),
  action TEXT NOT NULL CHECK(action IN ('BUY','SELL','UNKNOWN')),
  quantity REAL,
  unit_price REAL,
  fee_usd REAL,
  occurred_at TEXT,
  market_label TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(provider,fill_id)
);
CREATE INDEX IF NOT EXISTS idx_exchange_fill_groups ON exchange_bet_fills(provider,group_id);
CREATE INDEX IF NOT EXISTS idx_exchange_fill_market ON exchange_bet_fills(provider,market,side);
CREATE TABLE IF NOT EXISTS exchange_bet_settlements (
  provider TEXT NOT NULL,
  market TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('YES','NO','VOID')),
  yes_contracts REAL,
  no_contracts REAL,
  settled_at TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(provider,market)
);

INSERT OR IGNORE INTO schema_migrations(id,applied_at) VALUES
 ('0121_exchange_bet_execution_journal',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
