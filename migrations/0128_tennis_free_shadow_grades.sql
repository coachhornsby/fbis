-- Append-only independent Tennis prospective grades. Source and forecast receipts are immutable.
-- Cross-store inputs are copied into each grade: never rederive an old Brier from mutable tables.
CREATE TABLE IF NOT EXISTS tennis_free_shadow_grades (
 grade_id TEXT PRIMARY KEY,
 forecast_snapshot_id TEXT NOT NULL UNIQUE REFERENCES tennis_free_shadow_forecasts(snapshot_id),
 canonical_event_id TEXT NOT NULL,
 tour TEXT NOT NULL CHECK(tour IN ('atp','wta')),
 model_id TEXT NOT NULL CHECK(model_id='FBIS-TENNIS-FREE-SURFACE-v0.1-SHADOW'),
 player1_id TEXT NOT NULL,
 player2_id TEXT NOT NULL,
 outcome_winner_id TEXT NOT NULL,
 outcome_p1 INTEGER NOT NULL CHECK(outcome_p1 IN (0,1)),
 forecast_at TEXT NOT NULL,
 event_start_time TEXT NOT NULL,
 outcome_observed_at TEXT NOT NULL,
 official_result_raw_key TEXT NOT NULL,
 official_result_hash TEXT NOT NULL,
 challenger_p1 REAL NOT NULL CHECK(challenger_p1>0 AND challenger_p1<1),
 challenger_brier REAL NOT NULL CHECK(challenger_brier>=0 AND challenger_brier<=1),
 challenger_log_loss REAL NOT NULL CHECK(challenger_log_loss>=0),
 challenger_correct INTEGER NOT NULL CHECK(challenger_correct IN (0,1)),
 v2_snapshot_id TEXT,
 v2_p1 REAL CHECK(v2_p1>0 AND v2_p1<1),
 v2_brier REAL CHECK(v2_brier>=0 AND v2_brier<=1),
 v2_log_loss REAL CHECK(v2_log_loss>=0),
 ranking_snapshot_id TEXT,
 ranking_p1 REAL CHECK(ranking_p1>0 AND ranking_p1<1),
 ranking_brier REAL CHECK(ranking_brier>=0 AND ranking_brier<=1),
 ranking_log_loss REAL CHECK(ranking_log_loss>=0),
 fully_paired INTEGER NOT NULL DEFAULT 0 CHECK(fully_paired IN (0,1)),
 grade_context_json TEXT NOT NULL,
 graded_at TEXT NOT NULL,
 calibrated INTEGER NOT NULL DEFAULT 0 CHECK(calibrated=0),
 promotion_ready INTEGER NOT NULL DEFAULT 0 CHECK(promotion_ready=0),
 contract_trading_authorized INTEGER NOT NULL DEFAULT 0 CHECK(contract_trading_authorized=0),
 CHECK ((v2_snapshot_id IS NULL AND v2_p1 IS NULL AND v2_brier IS NULL AND v2_log_loss IS NULL)
      OR (v2_snapshot_id IS NOT NULL AND v2_p1 IS NOT NULL AND v2_brier IS NOT NULL AND v2_log_loss IS NOT NULL)),
 CHECK ((ranking_snapshot_id IS NULL AND ranking_p1 IS NULL AND ranking_brier IS NULL AND ranking_log_loss IS NULL)
      OR (ranking_snapshot_id IS NOT NULL AND ranking_p1 IS NOT NULL AND ranking_brier IS NOT NULL AND ranking_log_loss IS NOT NULL)),
 CHECK (fully_paired=0 OR (v2_snapshot_id IS NOT NULL AND ranking_snapshot_id IS NOT NULL)),
 CHECK (forecast_at<event_start_time),
 CHECK (forecast_at<outcome_observed_at)
);
CREATE INDEX IF NOT EXISTS idx_tennis_free_grade_cohort ON tennis_free_shadow_grades(tour,fully_paired,graded_at);
CREATE TRIGGER IF NOT EXISTS tennis_free_grade_immutable_update
 BEFORE UPDATE ON tennis_free_shadow_grades
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TENNIS_PROSPECTIVE_GRADE'); END;
CREATE TRIGGER IF NOT EXISTS tennis_free_grade_immutable_delete
 BEFORE DELETE ON tennis_free_shadow_grades
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TENNIS_PROSPECTIVE_GRADE'); END;
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
 VALUES('0128_tennis_free_shadow_grades',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
