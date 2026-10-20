-- Compact current market quotes for board / comparisons.
-- One row per (source, sport, event, market, side, line, market_id, outcome_id).
-- Full-resolution ticks remain in normalized_market_observations (bounded hot window)
-- and R2 archives. Never authorizes wagers by itself.

CREATE TABLE IF NOT EXISTS latest_market_state (
  state_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  sport TEXT NOT NULL,
  canonical_event_id TEXT,
  market_family TEXT NOT NULL,
  side TEXT,
  line REAL,
  source_market_id TEXT,
  source_outcome_id TEXT,
  contract_price REAL,
  decimal_odds REAL,
  american_odds REAL,
  source_observed_at TEXT,
  collected_at TEXT NOT NULL,
  snapshot_type TEXT NOT NULL DEFAULT 'CURRENT',
  raw_payload_json TEXT,
  observation_id TEXT,
  updated_at TEXT NOT NULL,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_latest_market_event
  ON latest_market_state(sport, canonical_event_id, market_family, collected_at);

CREATE INDEX IF NOT EXISTS idx_latest_market_updated
  ON latest_market_state(updated_at);
