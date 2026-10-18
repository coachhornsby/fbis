-- 0113: CFB end-to-end validation run ledger (weekly regression persistence).
-- Read-only operational audit storage; never mutates champion coefficients or wager gates.

CREATE TABLE IF NOT EXISTS cfb_e2e_validation_runs (
  run_id TEXT PRIMARY KEY,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  triggered_by TEXT NOT NULL DEFAULT 'weekly_regression',
  overall_pass INTEGER NOT NULL DEFAULT 0,
  five_essentials_json TEXT,
  acquisition_pass INTEGER,
  classification_pass INTEGER,
  consumption_pass INTEGER,
  impact_pass INTEGER,
  accuracy_pass INTEGER,
  cards_pass INTEGER,
  weekly_pass INTEGER,
  unresolved_json TEXT,
  report_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cfb_e2e_validation_season_week
  ON cfb_e2e_validation_runs(season, week, created_at DESC);

INSERT OR IGNORE INTO schema_migrations(id, applied_at)
VALUES ('0113_cfb_e2e_validation', datetime('now'));
