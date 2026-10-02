-- PrizePicks acquisition guard: one paid full-board actor start per CT calendar day.
CREATE TABLE IF NOT EXISTS prizepicks_daily_acquisitions (
  ct_date TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  state TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'zen-studio/prizepicks-player-props',
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  actual_cost_usd REAL,
  rows_returned INTEGER,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_pp_daily_acq_state ON prizepicks_daily_acquisitions(state, started_at);
INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0036_prizepicks_daily_acquisition_guard', datetime('now'));
