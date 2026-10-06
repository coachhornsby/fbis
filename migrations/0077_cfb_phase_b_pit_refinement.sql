-- CFB Phase B PIT refinement: game-timestamp bounds and explicit temporal uncertainty.
-- Additive correction to migration 0075. No model or wager authority.

ALTER TABLE cfb_roster_membership ADD COLUMN first_game_at TEXT;
ALTER TABLE cfb_roster_membership ADD COLUMN last_game_at TEXT;
ALTER TABLE cfb_roster_membership ADD COLUMN pit_resolvable INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cfb_roster_membership ADD COLUMN temporal_confidence REAL;

ALTER TABLE cfb_roster_observations ADD COLUMN first_game_at TEXT;
ALTER TABLE cfb_roster_observations ADD COLUMN last_game_at TEXT;
ALTER TABLE cfb_roster_observations ADD COLUMN pit_resolvable INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cfb_roster_observations ADD COLUMN temporal_confidence REAL;

ALTER TABLE cfb_roster_source_coverage ADD COLUMN pit_unresolved_memberships INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_cfb_roster_pit_resolvable
  ON cfb_roster_membership(player_id,season,pit_resolvable,effective_from,effective_to);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0077_cfb_phase_b_pit_refinement',datetime('now'));
