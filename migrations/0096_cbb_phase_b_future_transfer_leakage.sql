-- CBB Phase B explicit future-transfer leakage QA.
-- Rebuild the Phase B snapshot table instead of ALTER TABLE. The production table is
-- currently empty and the prior ALTER caused a remote D1_RESET_DO. The copy keeps
-- this migration safe if rows exist in another environment.
DROP TABLE IF EXISTS cbb_game_state_snapshots_v2;

CREATE TABLE cbb_game_state_snapshots_v2 (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, season INTEGER NOT NULL, game_start TEXT NOT NULL,
  feature_cutoff TEXT NOT NULL, home_team_id TEXT NOT NULL, away_team_id TEXT NOT NULL,
  home_state_json TEXT NOT NULL, away_state_json TEXT NOT NULL, unresolved_json TEXT NOT NULL,
  temporal_integrity_ok INTEGER NOT NULL, post_tip_observations INTEGER NOT NULL DEFAULT 0,
  future_membership_leaks INTEGER NOT NULL DEFAULT 0, future_availability_leaks INTEGER NOT NULL DEFAULT 0,
  future_lineup_leaks INTEGER NOT NULL DEFAULT 0, future_transfer_leaks INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'SHADOW',
  overlay_version TEXT NOT NULL DEFAULT 'FBIS-STATE-OVERLAY-v1',
  research_only INTEGER NOT NULL DEFAULT 1, can_influence_projection INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0, can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  provenance_json TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(game_id,feature_cutoff)
);

INSERT INTO cbb_game_state_snapshots_v2 (
  id,game_id,season,game_start,feature_cutoff,home_team_id,away_team_id,
  home_state_json,away_state_json,unresolved_json,temporal_integrity_ok,
  post_tip_observations,future_membership_leaks,future_availability_leaks,
  future_lineup_leaks,future_transfer_leaks,mode,overlay_version,research_only,
  can_influence_projection,can_qualify,can_authorize_wager,provenance_json,created_at
)
SELECT
  id,game_id,season,game_start,feature_cutoff,home_team_id,away_team_id,
  home_state_json,away_state_json,unresolved_json,temporal_integrity_ok,
  post_tip_observations,future_membership_leaks,future_availability_leaks,
  future_lineup_leaks,0,mode,overlay_version,research_only,
  can_influence_projection,can_qualify,can_authorize_wager,provenance_json,created_at
FROM cbb_game_state_snapshots;

DROP INDEX IF EXISTS idx_cbb_game_state_cutoff;
DROP TABLE cbb_game_state_snapshots;
ALTER TABLE cbb_game_state_snapshots_v2 RENAME TO cbb_game_state_snapshots;
CREATE INDEX IF NOT EXISTS idx_cbb_game_state_cutoff
  ON cbb_game_state_snapshots(feature_cutoff,game_start);

INSERT OR IGNORE INTO schema_migrations(id, applied_at)
VALUES ('0096_cbb_phase_b_future_transfer_leakage', datetime('now'));
