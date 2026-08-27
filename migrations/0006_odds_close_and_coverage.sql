-- Close capture: period, event id, kickoff, post-start rejection, pairing flag.
-- Versioned. Tracked in schema_migrations.

ALTER TABLE odds_snapshots ADD COLUMN period TEXT;
ALTER TABLE odds_snapshots ADD COLUMN event_id TEXT;
ALTER TABLE odds_snapshots ADD COLUMN game_start TEXT;
ALTER TABLE odds_snapshots ADD COLUMN checkpoint TEXT;
ALTER TABLE odds_snapshots ADD COLUMN rejected_post_start INTEGER DEFAULT 0;
ALTER TABLE odds_snapshots ADD COLUMN paired INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_odds_close ON odds_snapshots (game_id, market, side, captured_at);
