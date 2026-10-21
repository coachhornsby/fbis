-- Tennis Abstract live Elo report: private research data with source-date provenance.
-- NOT official ATP/WTA fixtures; NOT a verified current match history backfill.
-- Public or commercial reuse requires separate license review.
CREATE TABLE IF NOT EXISTS tennis_abstract_elo_runs (
 tour TEXT NOT NULL CHECK(tour IN ('atp','wta')),
 report_date TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 source_url TEXT NOT NULL,
 source_label TEXT NOT NULL DEFAULT 'TENNIS_ABSTRACT_LIVE_ELO',
 player_count INTEGER NOT NULL,
 retrieved_at TEXT NOT NULL,
 research_only INTEGER NOT NULL DEFAULT 1 CHECK(research_only=1),
 can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0),
 PRIMARY KEY(tour,report_date,source_hash)
);
CREATE TABLE IF NOT EXISTS tennis_abstract_elo_players (
 tour TEXT NOT NULL CHECK(tour IN ('atp','wta')),
 report_date TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 player_key TEXT NOT NULL,
 player_name TEXT NOT NULL,
 elo_rank INTEGER NOT NULL,
 overall_elo REAL NOT NULL,
 hard_elo REAL,
 clay_elo REAL,
 grass_elo REAL,
 official_rank_display INTEGER,
 source_url TEXT NOT NULL,
 retrieved_at TEXT NOT NULL,
 PRIMARY KEY(tour,report_date,source_hash,player_key)
);
CREATE INDEX IF NOT EXISTS idx_tennis_abstract_elo_latest ON tennis_abstract_elo_runs(tour,report_date DESC,retrieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_tennis_abstract_elo_player ON tennis_abstract_elo_players(tour,player_key,report_date DESC);
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
 VALUES ('0118_tennis_abstract_live_elo_research',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
