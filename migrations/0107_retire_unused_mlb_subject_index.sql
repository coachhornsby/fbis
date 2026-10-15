-- Current MLB projection readers filter by game/date or market type, never subject_id.
-- Retain the game and market indexes and every projection row.
DROP INDEX IF EXISTS idx_mlb_market_proj_subject;
INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES ('0107_retire_unused_mlb_subject_index',datetime('now'));
