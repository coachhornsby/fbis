ALTER TABLE nhl_wager_decisions ADD COLUMN game_type INTEGER;
CREATE INDEX IF NOT EXISTS idx_nhl_wager_decisions_game_type ON nhl_wager_decisions(game_type,wager_scope,snapshot_at);
INSERT OR IGNORE INTO schema_migrations(id,applied_at) VALUES('0044_nhl_wager_game_type',datetime('now'));
