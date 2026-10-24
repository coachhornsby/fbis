-- Tennis independently calculated ranking-based research challenger.
-- Wager authorization is deliberately impossible through this table.
-- All probability inputs must be recorded as observed before forecast time.
CREATE TABLE IF NOT EXISTS tennis_inhouse_rank_challenger (
 snapshot_id TEXT PRIMARY KEY,
 canonical_event_id TEXT NOT NULL,
 tour TEXT NOT NULL CHECK(tour IN ('atp','wta')),
 model_id TEXT NOT NULL CHECK(model_id='TENNIS-INHOUSE-RANK-BASELINE-v1'),
 player1_id TEXT NOT NULL,
 player2_id TEXT NOT NULL,
 player1_rank INTEGER NOT NULL CHECK(player1_rank BETWEEN 1 AND 5000),
 player2_rank INTEGER NOT NULL CHECK(player2_rank BETWEEN 1 AND 5000),
 rank_observation1_id TEXT NOT NULL,
 rank_observation2_id TEXT NOT NULL,
 rank_observed1_at TEXT NOT NULL,
 rank_observed2_at TEXT NOT NULL,
 p1_win REAL NOT NULL CHECK(p1_win>0 AND p1_win<1),
 p2_win REAL NOT NULL CHECK(p2_win>0 AND p2_win<1),
 forecast_at TEXT NOT NULL,
 event_start_time TEXT NOT NULL,
 source_rights_status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED'
  CHECK(source_rights_status='REVIEW_REQUIRED'),
 decision_eligible INTEGER NOT NULL DEFAULT 0 CHECK(decision_eligible=0),
 can_qualify INTEGER NOT NULL DEFAULT 0 CHECK(can_qualify=0),
 can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0),
 created_at TEXT NOT NULL,
 UNIQUE(canonical_event_id,model_id,forecast_at),
 FOREIGN KEY(canonical_event_id) REFERENCES tennis_official_matches(match_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_inhouse_rank_challenger_event
 ON tennis_inhouse_rank_challenger(canonical_event_id,forecast_at DESC);
