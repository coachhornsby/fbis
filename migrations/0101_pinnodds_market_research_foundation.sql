-- PinnOdds free REST budget and source-state, isolated from model/wager authority.
-- Every attempted request consumes a slot, including HTTP errors and timeouts.
CREATE TABLE IF NOT EXISTS pinnodds_api_requests (
  id TEXT PRIMARY KEY,
  utc_day TEXT NOT NULL,
  utc_minute TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('routine','diagnostic')),
  sport_id INTEGER NOT NULL,
  reserved_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RESERVED',
  http_status INTEGER,
  data_status TEXT,
  data_age_ms INTEGER,
  event_count INTEGER,
  offer_count INTEGER,
  error_code TEXT,
  retry_after_until TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pinnodds_budget_day ON pinnodds_api_requests(utc_day,purpose);
CREATE INDEX IF NOT EXISTS idx_pinnodds_budget_minute ON pinnodds_api_requests(utc_minute);

CREATE TABLE IF NOT EXISTS pinnodds_feed_state (
  sport_id INTEGER PRIMARY KEY CHECK(sport_id BETWEEN 1 AND 6),
  provider_cursor INTEGER,
  last_full_at TEXT,
  last_success_at TEXT,
  last_checked_at TEXT,
  last_data_status TEXT,
  last_data_age_ms INTEGER,
  last_event_count INTEGER,
  last_offer_count INTEGER,
  last_failure TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pinnodds_fixture_state (
  sport_id INTEGER NOT NULL,
  provider_event_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  withdrawn_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(sport_id,provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_pinnodds_fixture_active ON pinnodds_fixture_state(sport_id,active,last_seen_at);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES ('0101_pinnodds_market_research_foundation',datetime('now'));
