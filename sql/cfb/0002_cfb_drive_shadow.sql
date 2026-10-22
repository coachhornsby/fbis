-- CFB_DB ONLY: source-reconciled historical drive observations and shadow v2.
-- NEVER use migrations/*.sql: that canonical pipeline targets primary FBIS D1.
CREATE TABLE IF NOT EXISTS cfb_drive_verified_games (
 game_id TEXT PRIMARY KEY NOT NULL,
 source TEXT NOT NULL CHECK(source='CFBD_DRIVES'),
 source_fingerprint TEXT NOT NULL,
 source_observed_at TEXT NOT NULL,
 kickoff TEXT NOT NULL,
 graded_at TEXT NOT NULL,
 model_version TEXT NOT NULL CHECK(model_version='CFB-FBIS-v2'),
 projected_home REAL NOT NULL, projected_away REAL NOT NULL,
 actual_home REAL NOT NULL, actual_away REAL NOT NULL,
 drive_count INTEGER NOT NULL CHECK(drive_count BETWEEN 12 AND 70),
 drives_json TEXT NOT NULL,
 period_scope TEXT NOT NULL DEFAULT 'REGULATION_ONLY' CHECK(period_scope='REGULATION_ONLY'),
 verified_against_game INTEGER NOT NULL DEFAULT 1 CHECK(verified_against_game=1),
 authority TEXT NOT NULL DEFAULT 'RESEARCH_SHADOW_ONLY' CHECK(authority='RESEARCH_SHADOW_ONLY'),
 can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0)
);
CREATE INDEX IF NOT EXISTS idx_cfb_drive_source_asof ON cfb_drive_verified_games(source_observed_at);
CREATE TABLE IF NOT EXISTS cfb_drive_shadow_runs (
 id TEXT PRIMARY KEY NOT NULL,
 game_id TEXT NOT NULL,
 snapshot_id TEXT NOT NULL,
 source_model TEXT NOT NULL CHECK(source_model='CFB-FBIS-v2'),
 frozen_at TEXT NOT NULL, kickoff TEXT NOT NULL,
 generated_at TEXT NOT NULL,
 simulator_version TEXT NOT NULL CHECK(simulator_version='CFB-DRIVE-STATE-SHADOW-v2'),
 evidence_fingerprint TEXT NOT NULL,
 training_games INTEGER NOT NULL CHECK(training_games>=20),
 training_drives INTEGER NOT NULL CHECK(training_drives>=300),
 iterations INTEGER NOT NULL,
 seed INTEGER NOT NULL,
 baseline_json TEXT NOT NULL,
 distributions_json TEXT NOT NULL,
 period_scope TEXT NOT NULL DEFAULT 'REGULATION_ONLY' CHECK(period_scope='REGULATION_ONLY'),
 authority TEXT NOT NULL DEFAULT 'RESEARCH_SHADOW_ONLY' CHECK(authority='RESEARCH_SHADOW_ONLY'),
 can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0),
 UNIQUE(snapshot_id,simulator_version)
);
CREATE INDEX IF NOT EXISTS idx_cfb_drive_shadow_runs_game ON cfb_drive_shadow_runs(game_id,frozen_at DESC);
CREATE TABLE IF NOT EXISTS cfb_drive_shadow_grades (
 run_id TEXT PRIMARY KEY NOT NULL,
 game_id TEXT NOT NULL,
 source_fingerprint TEXT NOT NULL,
 score_home REAL NOT NULL, score_away REAL NOT NULL,
 source_observed_at TEXT NOT NULL,
 total_mae REAL NOT NULL,margin_mae REAL NOT NULL,
 total_50_covered INTEGER NOT NULL,total_80_covered INTEGER NOT NULL,total_90_covered INTEGER NOT NULL,
 margin_50_covered INTEGER NOT NULL,margin_80_covered INTEGER NOT NULL,margin_90_covered INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 authority TEXT NOT NULL DEFAULT 'RESEARCH_SHADOW_ONLY' CHECK(authority='RESEARCH_SHADOW_ONLY'),
 FOREIGN KEY(run_id) REFERENCES cfb_drive_shadow_runs(id)
);
