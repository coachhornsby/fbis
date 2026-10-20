-- Point-in-time goalie confirmation, available before the game.
--
-- resolveNhlGoalieStarterEvidence requires a named source, an explicit event id
-- and the original announcement time before it returns CONFIRMED. Those columns
-- were absent, so the writer could only store LAST_CONFIRMED_STARTER,
-- EXPECTED_G1 or DEPTH.
--
-- confirmation_observed_at is the time the announcement was first seen. A later
-- profile refresh must not bump it. evidence_class separates a pregame
-- announcement (POSITIVE), an explicit scratch (NEGATIVE) and the absence of
-- either (MISSING).
ALTER TABLE nhl_goalie_profiles ADD COLUMN confirmation_observed_at TEXT;
ALTER TABLE nhl_goalie_profiles ADD COLUMN confirmation_game_id TEXT;
ALTER TABLE nhl_goalie_profiles ADD COLUMN confirmation_source TEXT;
ALTER TABLE nhl_goalie_profiles ADD COLUMN evidence_class TEXT;

CREATE INDEX IF NOT EXISTS idx_nhl_goalie_profiles_confirmation
  ON nhl_goalie_profiles(confirmation_game_id, confirmation_observed_at);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0117_nhl_goalie_confirmation',datetime('now'));
