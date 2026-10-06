-- NBA Phase 3 prospective three-model ablation ledger.
CREATE TABLE IF NOT EXISTS nba_prospective_game_shadow (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  tipoff_timestamp TEXT,
  prediction_timestamp TEXT NOT NULL,
  feature_cutoff_timestamp TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  code_sha TEXT NOT NULL,
  control_projection_id TEXT,
  team_state_snapshot_ids_json TEXT,
  lineup_state_json TEXT,
  availability_state_json TEXT,
  schedule_state_json TEXT,
  market_snapshot_id TEXT,
  lifecycle TEXT NOT NULL DEFAULT 'SHADOW',
  projected_home REAL,
  projected_away REAL,
  projected_margin REAL,
  projected_total REAL,
  expected_possessions REAL,
  p_home_win REAL,
  sigma_margin REAL,
  sigma_total REAL,
  overlay_json TEXT,
  injury_buckets_json TEXT,
  schedule_buckets_json TEXT,
  market_used_as_feature INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  actual_home REAL,
  actual_away REAL,
  graded_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(game_id,prediction_timestamp,model_id,model_version)
);
CREATE INDEX IF NOT EXISTS idx_nba_prospective_shadow_game ON nba_prospective_game_shadow(game_id,prediction_timestamp);
CREATE INDEX IF NOT EXISTS idx_nba_prospective_shadow_model ON nba_prospective_game_shadow(model_id,model_version,prediction_timestamp);

CREATE TABLE IF NOT EXISTS nba_prospective_gate (
  gate_version TEXT PRIMARY KEY,
  frozen_at TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  auto_promote INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'FROZEN_RESEARCH_GATE'
);

INSERT OR IGNORE INTO nba_prospective_gate(gate_version,frozen_at,rules_json,auto_promote,can_qualify,can_authorize,status)
VALUES('NBA-PROSPECTIVE-GATE-v1',datetime('now'),'{"minimumGradedGames":100,"marginImprovementMin":0.005,"totalImprovementMin":0.003,"winnerAccuracyFloorVsV1":-0.005,"brierNonInferiority":0.002,"logLossNonInferiority":0.005,"eceMax":0.04,"clv":{"minimumEvaluatedBets":50,"positiveClvRateMin":0.52,"meanProbabilityClvMin":0.0},"economics":{"minimumSettledBets":50,"roiMustBePositive":true,"unitsMustBePositive":true,"maxDrawdownUnitsMax":12},"subgroups":{"injuryMinimumN":20,"scheduleStressMinimumN":20,"catastrophicRegressionTolerance":0.05},"resultOnPass":"PROMOTION_ELIGIBLE","operatorApprovalRequired":true}',0,0,0,'FROZEN_RESEARCH_GATE');

INSERT OR IGNORE INTO schema_migrations(id,applied_at) VALUES('0069_nba_prospective_profile_ablation',datetime('now'));
