-- Immutable, evidence-linked settlement grades. Never confers wagering authorization.
CREATE TABLE IF NOT EXISTS tennis_inhouse_rank_grades (
 snapshot_id TEXT PRIMARY KEY REFERENCES tennis_inhouse_rank_challenger(snapshot_id),
 canonical_event_id TEXT NOT NULL,
 tour TEXT NOT NULL CHECK(tour IN ('atp','wta')),
 winner_id TEXT NOT NULL,
 result_raw_artifact_key TEXT NOT NULL,
 p1_win REAL NOT NULL CHECK(p1_win>0 AND p1_win<1),
 actual_p1 INTEGER NOT NULL CHECK(actual_p1 IN (0,1)),
 brier REAL NOT NULL,
 log_loss REAL NOT NULL,
 hit INTEGER NOT NULL CHECK(hit IN (0,1)),
 graded_at TEXT NOT NULL,
 can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0)
);
CREATE TRIGGER IF NOT EXISTS tennis_rank_grades_immutable_update
 BEFORE UPDATE ON tennis_inhouse_rank_grades BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GRADE'); END;
CREATE TRIGGER IF NOT EXISTS tennis_rank_grades_immutable_delete
 BEFORE DELETE ON tennis_inhouse_rank_grades BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GRADE'); END;
INSERT OR IGNORE INTO schema_migrations(id,applied_at) VALUES('0124_tennis_challenger_grades',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
