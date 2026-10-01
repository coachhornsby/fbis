-- 0035_prizepicks_player_headshots.sql
-- Persist player imagery supplied by the PrizePicks feed for the visual props workspace.
ALTER TABLE prizepicks_prop_lines ADD COLUMN player_headshot_url TEXT;
ALTER TABLE prizepicks_prop_observations ADD COLUMN player_headshot_url TEXT;

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0035_prizepicks_player_headshots', datetime('now'));
