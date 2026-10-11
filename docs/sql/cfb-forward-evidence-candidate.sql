-- Isolated candidate only. No automatic production migration.
CREATE TABLE IF NOT EXISTS cfb_forward_snapshots (
 id TEXT PRIMARY KEY, game_id TEXT NOT NULL, decision_at TEXT NOT NULL,
 event_start_at TEXT NOT NULL CHECK(decision_at < event_start_at),
 content_hash TEXT NOT NULL, body_json TEXT NOT NULL,
 can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0)
);
CREATE INDEX IF NOT EXISTS idx_cfb_forward_game_time ON cfb_forward_snapshots(game_id,decision_at);
CREATE TRIGGER IF NOT EXISTS cfb_forward_no_update BEFORE UPDATE ON cfb_forward_snapshots BEGIN SELECT RAISE(ABORT,'immutable pregame evidence'); END;
CREATE TRIGGER IF NOT EXISTS cfb_forward_no_delete BEFORE DELETE ON cfb_forward_snapshots BEGIN SELECT RAISE(ABORT,'immutable pregame evidence'); END;
