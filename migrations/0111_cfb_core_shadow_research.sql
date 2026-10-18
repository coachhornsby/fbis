-- 0111: CFB CORE prospective shadow research ledger (TIER3_DB / research storage).
-- Research-only. Never authorizes wagers or mutates the CFB champion.
-- Immutable pregame rows: INSERT OR IGNORE only; settlement updates score columns only.

CREATE TABLE IF NOT EXISTS cfb_core_shadow_predictions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  kickoff TEXT NOT NULL,
  home_team_id TEXT,
  away_team_id TEXT,
  home_team TEXT,
  away_team TEXT,
  home_conference TEXT,
  away_conference TEXT,
  neutral_site INTEGER NOT NULL DEFAULT 0,
  generation_at TEXT NOT NULL,
  feature_cutoff_at TEXT,
  core_through_week INTEGER,
  core_year INTEGER,
  core_source_as_of_home TEXT,
  core_source_as_of_away TEXT,
  core_source_endpoint TEXT,
  eligibility TEXT NOT NULL DEFAULT 'pending',
  missing_reason TEXT,
  champion_model_id TEXT NOT NULL,
  champion_model_version TEXT,
  champion_spread REAL,
  champion_total REAL,
  champion_home REAL,
  champion_away REAL,
  champion_p_home_win REAL,
  core_model_id TEXT NOT NULL DEFAULT 'CFB-CORE-SHADOW-v1',
  core_model_version TEXT,
  core_artifact_id TEXT,
  core_spread REAL,
  core_total REAL,
  core_home REAL,
  core_away REAL,
  core_p_home_win REAL,
  core_cross_margin REAL,
  core_cross_total REAL,
  home_core_offense REAL,
  home_core_defense REAL,
  away_core_offense REAL,
  away_core_defense REAL,
  hfa_points REAL,
  disagreement_spread REAL,
  disagreement_total REAL,
  disagreement_driver TEXT,
  market_spread REAL,
  market_total REAL,
  market_ml_home INTEGER,
  market_ml_away INTEGER,
  market_captured_at TEXT,
  market_source TEXT,
  market_observation_id TEXT,
  research_signal_json TEXT,
  vector_json TEXT,
  provenance_json TEXT NOT NULL,
  authority TEXT NOT NULL DEFAULT 'research_only' CHECK(authority='research_only'),
  can_qualify INTEGER NOT NULL DEFAULT 0 CHECK(can_qualify=0),
  can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0),
  can_influence_production INTEGER NOT NULL DEFAULT 0 CHECK(can_influence_production=0),
  closing_spread REAL,
  closing_total REAL,
  closing_captured_at TEXT,
  actual_home REAL,
  actual_away REAL,
  final_verified INTEGER NOT NULL DEFAULT 0,
  settled_at TEXT,
  settlement_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(game_id, core_model_id, generation_at)
);

CREATE INDEX IF NOT EXISTS idx_cfb_core_shadow_week
  ON cfb_core_shadow_predictions(season, week, kickoff);
CREATE INDEX IF NOT EXISTS idx_cfb_core_shadow_game
  ON cfb_core_shadow_predictions(game_id, generation_at);
CREATE INDEX IF NOT EXISTS idx_cfb_core_shadow_settle
  ON cfb_core_shadow_predictions(final_verified, settled_at, kickoff);

CREATE TABLE IF NOT EXISTS cfb_core_evaluation_reports (
  report_id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL,
  season INTEGER,
  week INTEGER,
  generated_at TEXT NOT NULL,
  sample_n INTEGER NOT NULL DEFAULT 0,
  classification TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  folds_json TEXT,
  market_json TEXT,
  ablation_json TEXT,
  coverage_json TEXT,
  residual_risks_json TEXT,
  authority TEXT NOT NULL DEFAULT 'research_only' CHECK(authority='research_only'),
  can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0),
  artifact_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cfb_core_eval_type
  ON cfb_core_evaluation_reports(report_type, generated_at DESC);

CREATE TABLE IF NOT EXISTS cfb_core_research_artifacts (
  artifact_id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL DEFAULT 'CFB-CORE-SHADOW-v1',
  version TEXT NOT NULL,
  verified_oos INTEGER NOT NULL DEFAULT 0,
  last_training_season INTEGER,
  features_json TEXT NOT NULL,
  margin_json TEXT,
  total_json TEXT,
  evaluation_report_id TEXT,
  authority TEXT NOT NULL DEFAULT 'research_only' CHECK(authority='research_only'),
  can_influence_production INTEGER NOT NULL DEFAULT 0 CHECK(can_influence_production=0),
  can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_wager=0),
  created_at TEXT NOT NULL,
  frozen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cfb_core_promotion_gate (
  gate_version TEXT PRIMARY KEY,
  frozen_at TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  auto_promote INTEGER NOT NULL DEFAULT 0 CHECK(auto_promote=0),
  can_qualify INTEGER NOT NULL DEFAULT 0 CHECK(can_qualify=0),
  can_authorize INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize=0),
  status TEXT NOT NULL DEFAULT 'FROZEN_RESEARCH_GATE',
  operator_approval_required INTEGER NOT NULL DEFAULT 1 CHECK(operator_approval_required=1)
);

INSERT OR IGNORE INTO cfb_core_promotion_gate(gate_version,frozen_at,rules_json,auto_promote,can_qualify,can_authorize,status,operator_approval_required)
VALUES(
  'CFB-CORE-PROMOTION-GATE-v1',
  datetime('now'),
  '{"minOosN":400,"minSeasons":3,"minFolds":2,"requirePitHistoricalCore":true,"requireMultiSeasonOos":true,"minMaeImprovementMargin":0.15,"minMaeImprovementTotal":0.15,"maxBiasAbs":1.5,"maxBrierDegradation":0.02,"minCoverage":0.9,"requireMarketRelativeImprovement":true,"requirePositiveNetEvWithUncertainty":true,"requireProspectiveShadowConsistent":true,"requireNoIntegrityViolations":true,"resultOnPass":"PROMOTION_ELIGIBLE_PENDING_OPERATOR","neverEvidence":["one good week","small historical sample","disagreement alone","current Week-6 CORE treated as Week-7"]}',
  0,0,0,'FROZEN_RESEARCH_GATE',1
);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES ('0111_cfb_core_shadow_research',datetime('now'));
