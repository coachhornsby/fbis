-- Immutable shadow forecasts. Research only; never a tradable contract signal.
CREATE TABLE IF NOT EXISTS tennis_free_shadow_forecasts (
 snapshot_id TEXT PRIMARY KEY,
 canonical_event_id TEXT NOT NULL,
 tour TEXT NOT NULL CHECK(tour IN ('atp','wta')),
 model_id TEXT NOT NULL CHECK(model_id='FBIS-TENNIS-FREE-SURFACE-v0.1-SHADOW'),
 player1_id TEXT NOT NULL,
 player2_id TEXT NOT NULL,
 surface TEXT NOT NULL CHECK(surface IN ('hard','clay','grass')),
 event_source TEXT NOT NULL CHECK(event_source IN ('WTA_OFFICIAL','ATP_OFFICIAL')),
 event_observed_at TEXT NOT NULL,
 event_raw_artifact_key TEXT NOT NULL,
 forecast_at TEXT NOT NULL,
 event_start_time TEXT NOT NULL,
 p1_win REAL NOT NULL CHECK(p1_win>0 AND p1_win<1),
 p2_win REAL NOT NULL CHECK(p2_win>0 AND p2_win<1),
 input_hash TEXT NOT NULL,
 input_json TEXT NOT NULL,
 source_rights_status TEXT NOT NULL DEFAULT 'RESEARCH_ONLY_REVIEW_REQUIRED'
  CHECK(source_rights_status='RESEARCH_ONLY_REVIEW_REQUIRED'),
 calibrated INTEGER NOT NULL DEFAULT 0 CHECK(calibrated=0),
 decision_eligible INTEGER NOT NULL DEFAULT 0 CHECK(decision_eligible=0),
 contract_trading_authorized INTEGER NOT NULL DEFAULT 0 CHECK(contract_trading_authorized=0),
 created_at TEXT NOT NULL,
 UNIQUE(canonical_event_id,model_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_free_shadow_time
 ON tennis_free_shadow_forecasts(tour,event_start_time);
CREATE TRIGGER IF NOT EXISTS tennis_free_shadow_forecast_no_update
 BEFORE UPDATE ON tennis_free_shadow_forecasts
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TENNIS_SHADOW_FORECAST'); END;
CREATE TRIGGER IF NOT EXISTS tennis_free_shadow_forecast_no_delete
 BEFORE DELETE ON tennis_free_shadow_forecasts
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TENNIS_SHADOW_FORECAST'); END;
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
 VALUES('0127_tennis_free_shadow_forecasts',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
