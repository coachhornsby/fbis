-- Dedicated CFB_DB schema only. Do not add to migrations/*.sql (PRIMARY).
-- Applying this to fbis primary or the TIER3 research database is forbidden.
-- Store only compact 5,000-draw distribution summaries; no raw Monte Carlo paths.
CREATE TABLE IF NOT EXISTS cfb_sim_shadow_runs (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  champion_model_version TEXT NOT NULL,
  simulator_version TEXT NOT NULL,
  frozen_at TEXT NOT NULL,
  kickoff TEXT NOT NULL,
  training_count INTEGER NOT NULL CHECK(training_count>=60),
  training_fingerprint TEXT NOT NULL,
  seed INTEGER NOT NULL,
  iterations INTEGER NOT NULL,
  baseline_json TEXT NOT NULL,
  distributions_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  authority TEXT NOT NULL DEFAULT 'RESEARCH_SHADOW_ONLY'
    CHECK(authority='RESEARCH_SHADOW_ONLY'),
  can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0),
  UNIQUE(snapshot_id,simulator_version)
);
CREATE INDEX IF NOT EXISTS idx_cfb_sim_shadow_runs_game
  ON cfb_sim_shadow_runs(game_id,frozen_at DESC);
CREATE INDEX IF NOT EXISTS idx_cfb_sim_shadow_runs_generated
  ON cfb_sim_shadow_runs(generated_at DESC);
CREATE TABLE IF NOT EXISTS cfb_sim_shadow_grades (
  run_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  actual_home REAL NOT NULL,
  actual_away REAL NOT NULL,
  settled_at TEXT NOT NULL,
  score_mae REAL NOT NULL,
  total_absolute_error REAL NOT NULL,
  margin_absolute_error REAL NOT NULL,
  inside_50_total INTEGER NOT NULL,
  inside_80_total INTEGER NOT NULL,
  inside_90_total INTEGER NOT NULL,
  inside_80_margin INTEGER NOT NULL,
  inside_90_margin INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  authority TEXT NOT NULL DEFAULT 'RESEARCH_SHADOW_ONLY'
    CHECK(authority='RESEARCH_SHADOW_ONLY'),
  FOREIGN KEY (run_id) REFERENCES cfb_sim_shadow_runs(id)
);
