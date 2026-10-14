-- ESPN's independently observed upcoming tennis fixtures.
-- These are research-only source identities, NOT ATP/WTA official evidence and
-- NEVER evidence of provider quote time, projection/decision/wager authority.
CREATE TABLE IF NOT EXISTS tennis_external_fixtures (
 fixture_id TEXT PRIMARY KEY,
 source TEXT NOT NULL CHECK(source='ESPN_PUBLIC'),
 tour TEXT NOT NULL CHECK(tour IN ('atp','wta')),
 source_event_id TEXT NOT NULL,
 source_competition_id TEXT NOT NULL,
 match_time TEXT NOT NULL,
 player1_name TEXT NOT NULL,
 player2_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('SCHEDULED','IN_PROGRESS','FINAL')),
 fetched_at TEXT NOT NULL,
 raw_hash TEXT NOT NULL,
 raw_key TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(source,tour,source_event_id,source_competition_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_external_fixtures_time
 ON tennis_external_fixtures(tour,match_time,source);
