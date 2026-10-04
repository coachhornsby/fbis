-- NBA prospective-shadow grading and post-freeze market evidence.
ALTER TABLE nba_game_projections ADD COLUMN actual_home REAL;
ALTER TABLE nba_game_projections ADD COLUMN actual_away REAL;
ALTER TABLE nba_game_projections ADD COLUMN graded_at TEXT;
ALTER TABLE nba_game_projections ADD COLUMN market_at_projection_json TEXT;
ALTER TABLE nba_game_projections ADD COLUMN close_market_json TEXT;
ALTER TABLE nba_game_projections ADD COLUMN market_joined_at TEXT;

ALTER TABLE nba_player_prop_projections ADD COLUMN actual_value REAL;
ALTER TABLE nba_player_prop_projections ADD COLUMN graded_at TEXT;
ALTER TABLE nba_player_prop_projections ADD COLUMN availability_verified INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_nba_game_proj_ungraded
  ON nba_game_projections (game_id, graded_at, feature_cutoff_timestamp);
CREATE INDEX IF NOT EXISTS idx_nba_prop_proj_ungraded
  ON nba_player_prop_projections (game_id, graded_at, player_id, market_type);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0040_nba_prospective_shadow_grading', datetime('now'));
