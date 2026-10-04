-- NHL confidence audit runs. Evidence only; never rewrites immutable decisions.
CREATE TABLE IF NOT EXISTS nhl_wager_confidence_runs (
  id TEXT PRIMARY KEY,
  run_at TEXT NOT NULL,
  source TEXT NOT NULL,
  game_validated INTEGER NOT NULL DEFAULT 0,
  prop_validated INTEGER NOT NULL DEFAULT 0,
  game_n INTEGER NOT NULL DEFAULT 0,
  prop_n INTEGER NOT NULL DEFAULT 0,
  game_json TEXT NOT NULL,
  prop_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_conf_runs_at ON nhl_wager_confidence_runs(run_at DESC);
INSERT OR IGNORE INTO schema_migrations(id,applied_at) VALUES('0043_nhl_wager_confidence_runs',datetime('now'));
