ALTER TABLE soccer_competition_coverage ADD COLUMN last_live_sync_at TEXT;
ALTER TABLE soccer_competition_coverage ADD COLUMN live_sync_errors INTEGER NOT NULL DEFAULT 0;
ALTER TABLE soccer_competition_coverage ADD COLUMN live_sync_last_error TEXT;
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0060_soccer_live_fixture_rotation',datetime('now'));
