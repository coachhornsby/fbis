-- FBIS market-history D1 shard (independent database, no cross-D1 foreign keys).
-- Source-of-truth ledger remains on main D1 until shadow coverage, consumer
-- rewrites, immutable evidence, rollback, and full backfill reconciliation pass.
-- No bet qualification authority is granted by this table.
CREATE TABLE IF NOT EXISTS normalized_market_observations (
  id TEXT PRIMARY KEY,
  observation_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_type TEXT NOT NULL,
  sport TEXT NOT NULL,
  league TEXT,
  canonical_event_id TEXT,
  provider_event_id TEXT,
  event_start_time TEXT,
  home_team TEXT,
  away_team TEXT,
  canonical_player_id TEXT,
  provider_player_id TEXT,
  player_name TEXT,
  team TEXT,
  opponent TEXT,
  market_family TEXT NOT NULL,
  stat_family TEXT,
  side TEXT,
  line REAL,
  american_odds REAL,
  decimal_odds REAL,
  contract_price REAL,
  payout_multiplier REAL,
  standard_or_alt TEXT,
  promo INTEGER,
  period TEXT,
  source_market_id TEXT,
  source_outcome_id TEXT,
  source_observed_at TEXT,
  collected_at TEXT NOT NULL,
  snapshot_type TEXT NOT NULL DEFAULT 'CURRENT',
  model_id TEXT,
  model_version TEXT,
  model_probability REAL,
  fair_american_price REAL,
  raw_implied_probability REAL,
  no_vig_market_probability REAL,
  probability_edge REAL,
  expected_return_per_unit_risk REAL,
  execution_eligible INTEGER,
  decision_eligible INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  result_value REAL,
  result_side TEXT,
  settled_at TEXT,
  raw_payload_json TEXT,
  raw_payload_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shard_market_event
ON normalized_market_observations(sport,canonical_event_id,collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_shard_market_source
ON normalized_market_observations(source,collected_at DESC);
-- Preserve original SQLite source rowid and column-complete SHA-256 parity.
CREATE TABLE IF NOT EXISTS market_history_transfer_evidence (
  id TEXT PRIMARY KEY,
  source_db TEXT NOT NULL,
  source_rowid INTEGER NOT NULL,
  source_payload_sha256 TEXT NOT NULL,
  full_row_sha256 TEXT NOT NULL,
  pilot_batch TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(source_db,source_rowid),
  FOREIGN KEY(id) REFERENCES normalized_market_observations(id)
);
CREATE INDEX IF NOT EXISTS idx_shard_transfer_batch ON market_history_transfer_evidence(pilot_batch,source_rowid);
