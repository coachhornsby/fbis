-- ACTION immutable market observation time series (0024).
-- Append-only. Never overwrites prior book/prop observations.
-- Snapshot types (OPEN/CURRENT/DECISION/FINAL_PREGAME/CLOSE) are derived pointers
-- into this series — never a single mutable line row.
-- ACTION remains market intelligence only: no PURE features, no qualify, no authorize.

CREATE TABLE IF NOT EXISTS action_market_book_observations (
  id TEXT PRIMARY KEY,
  -- Unique identity of this observation moment. Collision ⇒ INSERT OR IGNORE (idempotent), never UPDATE.
  observation_key TEXT NOT NULL UNIQUE,
  canonical_event_id TEXT,
  canonical_player_id TEXT,
  provider_event_id TEXT NOT NULL,
  provider_player_id TEXT,
  sport TEXT NOT NULL,
  market_type TEXT NOT NULL,
  market_period TEXT NOT NULL DEFAULT 'event',
  selection TEXT NOT NULL,
  line REAL,
  american_price REAL,
  sportsbook TEXT NOT NULL,
  provider_timestamp TEXT,
  collected_at TEXT NOT NULL,
  event_start_time TEXT,
  -- Derived label only; observations themselves are never rewritten when labels change.
  snapshot_type TEXT,
  public_ticket_pct REAL,
  public_money_pct REAL,
  -- Derived by FBIS from ticket/money; never an assumed "sharp" label.
  money_minus_ticket_pct REAL,
  tracked_bet_count REAL,
  tracked_volume REAL,
  raw_payload_hash TEXT NOT NULL,
  match_confidence TEXT,
  schema_version TEXT NOT NULL,
  run_id TEXT,
  source_observation_id TEXT,
  decision_eligible INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_action_book_obs_event_market
  ON action_market_book_observations (canonical_event_id, market_type, market_period, selection, sportsbook, collected_at);

CREATE INDEX IF NOT EXISTS idx_action_book_obs_provider_event
  ON action_market_book_observations (provider_event_id, sport, collected_at);

CREATE INDEX IF NOT EXISTS idx_action_book_obs_player
  ON action_market_book_observations (canonical_player_id, market_type, collected_at);

CREATE INDEX IF NOT EXISTS idx_action_book_obs_snapshot
  ON action_market_book_observations (snapshot_type, sport, collected_at);

CREATE INDEX IF NOT EXISTS idx_action_book_obs_run
  ON action_market_book_observations (run_id);

-- Derived snapshot pointers into immutable observations. Pointers may advance;
-- underlying observation rows are never mutated or deleted by this layer.
CREATE TABLE IF NOT EXISTS action_market_snapshot_pointers (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  canonical_event_id TEXT,
  canonical_player_id TEXT,
  provider_event_id TEXT NOT NULL,
  provider_player_id TEXT,
  market_type TEXT NOT NULL,
  market_period TEXT NOT NULL DEFAULT 'event',
  selection TEXT NOT NULL,
  sportsbook TEXT NOT NULL,
  snapshot_type TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  observation_key TEXT NOT NULL,
  derived_at TEXT NOT NULL,
  event_start_time TEXT,
  FOREIGN KEY (observation_id) REFERENCES action_market_book_observations(id)
);

CREATE INDEX IF NOT EXISTS idx_action_snap_ptr_event
  ON action_market_snapshot_pointers (canonical_event_id, market_type, snapshot_type);

CREATE INDEX IF NOT EXISTS idx_action_snap_ptr_type
  ON action_market_snapshot_pointers (snapshot_type, sport, derived_at);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0024_action_observation_timeseries', datetime('now'));
