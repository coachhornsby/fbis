-- FBIS research store (Cloudflare D1). Cache is not a substitute.
-- Apply: wrangler d1 execute fbis --file=schema.sql --remote

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  date TEXT NOT NULL,
  start TEXT,
  home_name TEXT,
  away_name TEXT,
  home_abbr TEXT,
  away_abbr TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_versions (
  version TEXT PRIMARY KEY,
  sport TEXT,
  weights_json TEXT,
  created_at TEXT NOT NULL,
  status TEXT DEFAULT 'champion'
);

CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  date TEXT NOT NULL,
  matchup TEXT,
  checkpoint TEXT,
  model_version TEXT,
  as_of TEXT NOT NULL,
  proj_home REAL,
  proj_away REAL,
  proj_total REAL,
  proj_margin REAL,
  pal_home REAL,
  pal_away REAL,
  p_home_final REAL,
  p_away_final REAL,
  p_market REAL,
  p_espn REAL,
  p_score REAL,
  p_form REAL,
  p_pal REAL,
  weights_json TEXT,
  layers_json TEXT,
  pal_json TEXT,
  pal_as_of TEXT,
  lineups_official INTEGER,
  data_quality INTEGER,
  pin_home_ml REAL,
  pin_away_ml REAL,
  pin_vig REAL,
  engine TEXT,
  actual_home REAL,
  actual_away REAL,
  graded_at TEXT
);

CREATE TABLE IF NOT EXISTS prediction_snapshots (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  date TEXT NOT NULL,
  matchup TEXT,
  checkpoint TEXT NOT NULL,
  model_version TEXT,
  frozen_at TEXT NOT NULL,
  proj_home REAL,
  proj_away REAL,
  proj_total REAL,
  proj_margin REAL,
  pal_home REAL,
  pal_away REAL,
  pal_f5_home REAL,
  pal_f5_away REAL,
  pal_p_home REAL,
  pal_as_of TEXT,
  pal_request_id TEXT,
  pal_json TEXT,
  lineups_official INTEGER,
  p_home_final REAL,
  p_market REAL,
  p_espn REAL,
  p_score REAL,
  p_form REAL,
  p_pal REAL,
  weights_json TEXT,
  layers_json TEXT,
  data_quality INTEGER,
  pin_home_ml REAL,
  pin_away_ml REAL,
  pin_vig REAL,
  engine TEXT,
  actual_home REAL,
  actual_away REAL,
  graded_at TEXT,
  deployment_commit TEXT
);

CREATE TABLE IF NOT EXISTS prediction_layers (
  prediction_id TEXT NOT NULL,
  layer TEXT NOT NULL,
  p_home REAL,
  PRIMARY KEY (prediction_id, layer)
);

CREATE TABLE IF NOT EXISTS odds_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  date TEXT,
  book TEXT,
  market TEXT,
  side TEXT,
  line REAL,
  price REAL,
  implied REAL,
  no_vig REAL,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  date TEXT NOT NULL,
  sport TEXT NOT NULL,
  model_version TEXT NOT NULL DEFAULT '',
  checkpoint TEXT NOT NULL DEFAULT 'LATEST',
  n INTEGER,
  brier REAL,
  log_loss REAL,
  mae_total REAL,
  mae_margin REAL,
  winner_hit REAL,
  PRIMARY KEY (date, sport, model_version, checkpoint)
);

CREATE TABLE IF NOT EXISTS store_meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE TABLE IF NOT EXISTS team_form (
  sport TEXT NOT NULL,
  season INTEGER NOT NULL,
  team_key TEXT NOT NULL,
  games INTEGER,
  points_for REAL,
  points_against REAL,
  updated_at TEXT,
  PRIMARY KEY (sport, season, team_key)
);

CREATE TABLE IF NOT EXISTS team_form_games (
  sport TEXT NOT NULL,
  game_id TEXT NOT NULL,
  date TEXT,
  PRIMARY KEY (sport, game_id)
);

CREATE TABLE IF NOT EXISTS daily_reports (
  date TEXT NOT NULL,
  sport TEXT NOT NULL,
  body TEXT NOT NULL,
  metrics_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (date, sport)
);

CREATE TABLE IF NOT EXISTS strategies (
  id TEXT PRIMARY KEY,
  name TEXT,
  version INTEGER,
  rules_json TEXT,
  notes TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS strategy_tickets (
  id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  role TEXT NOT NULL,
  sport TEXT,
  date TEXT,
  game_id TEXT,
  matchup TEXT,
  market TEXT,
  side TEXT,
  pick TEXT,
  line REAL,
  ev REAL,
  edge REAL,
  tag TEXT,
  pin_vig REAL,
  pin_price REAL,
  model_version TEXT,
  checkpoint TEXT,
  data_quality INTEGER,
  result TEXT,
  profit REAL,
  clv REAL,
  traits_json TEXT,
  created_at TEXT,
  graded_at TEXT,
  qualified_at TEXT,
  execution_line REAL,
  execution_price REAL,
  benchmark_line REAL,
  benchmark_price REAL,
  entry_no_vig REAL,
  closing_line REAL,
  closing_price REAL,
  closing_no_vig REAL,
  stake REAL,
  missing_execution_price INTEGER,
  provenance TEXT,
  execution_book TEXT,
  benchmark_book TEXT,
  clv_version TEXT
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  trigger_type TEXT,
  started_at TEXT,
  completed_at TEXT,
  status TEXT,
  sport TEXT,
  dates_json TEXT,
  games_discovered INTEGER,
  writes_attempted INTEGER,
  writes_succeeded INTEGER,
  writes_failed INTEGER,
  finals_discovered INTEGER,
  finals_graded INTEGER,
  error_summary TEXT,
  deployment_commit TEXT,
  model_version TEXT,
  projections_generated INTEGER,
  writes_already INTEGER,
  immutable_conflicts INTEGER,
  finals_awaiting_retry INTEGER
);

CREATE INDEX IF NOT EXISTS idx_predictions_sport_date ON predictions (sport, date);
CREATE INDEX IF NOT EXISTS idx_snap_sport_date ON prediction_snapshots (sport, date);
CREATE INDEX IF NOT EXISTS idx_snap_game ON prediction_snapshots (game_id, date);
CREATE INDEX IF NOT EXISTS idx_odds_game_time ON odds_snapshots (game_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_job_runs_type_time ON job_runs (job_type, started_at);
CREATE INDEX IF NOT EXISTS idx_strategy_tickets_role ON strategy_tickets (strategy_id, role, date);

CREATE TABLE IF NOT EXISTS harvest_retry_queue (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  date TEXT NOT NULL,
  game_id TEXT,
  reason TEXT,
  attempts INTEGER DEFAULT 0,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL,
  status TEXT DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS write_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id TEXT,
  reason TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cfb_hfa_external (
  source TEXT NOT NULL,
  rating_year INTEGER NOT NULL,
  team_key TEXT NOT NULL,
  team_name TEXT,
  conference TEXT,
  raw_hfa REAL,
  smooth_hfa REAL,
  supplied_date TEXT,
  methodology TEXT,
  limitations TEXT,
  benchmark_only INTEGER DEFAULT 1,
  PRIMARY KEY (source, rating_year, team_key)
);

CREATE TABLE IF NOT EXISTS cfb_hfa_games (
  game_id TEXT PRIMARY KEY,
  season INTEGER,
  week INTEGER,
  kickoff TEXT,
  home_team_key TEXT,
  away_team_key TEXT,
  home_score REAL,
  away_score REAL,
  venue TEXT,
  neutral INTEGER,
  postseason INTEGER,
  conference_game INTEGER,
  overtime INTEGER,
  fbs_vs_fbs INTEGER,
  closing_spread REAL,
  closing_source TEXT,
  closing_at TEXT,
  source TEXT,
  source_ts TEXT
);

CREATE TABLE IF NOT EXISTS cfb_hfa_ratings (
  method TEXT NOT NULL,
  as_of_season INTEGER NOT NULL,
  team_key TEXT NOT NULL,
  national_baseline REAL,
  raw_hfa REAL,
  shrunken_hfa REAL,
  uncertainty REAL,
  games_used INTEGER,
  home_n INTEGER,
  road_n INTEGER,
  seasons_used INTEGER,
  n_eff REAL,
  reliability REAL,
  recency TEXT,
  method_version TEXT,
  available INTEGER,
  flags_json TEXT,
  updated_at TEXT,
  PRIMARY KEY (method, as_of_season, team_key)
);

CREATE VIEW IF NOT EXISTS pipeline_runs AS SELECT * FROM job_runs;

CREATE TABLE IF NOT EXISTS executed_bets (
  id TEXT PRIMARY KEY,
  external_ticket_id TEXT NOT NULL,
  execution_book TEXT NOT NULL DEFAULT 'Heritage',
  executed_at TEXT,
  timezone TEXT,
  sport TEXT,
  date TEXT,
  game_id TEXT,
  source_event_id TEXT,
  source_url TEXT,
  matchup_text TEXT,
  away_team TEXT,
  home_team TEXT,
  market TEXT,
  period TEXT,
  selected_side TEXT,
  selected_team TEXT,
  execution_line REAL,
  execution_price REAL,
  risk_amount REAL,
  to_win_amount REAL,
  potential_payout REAL,
  currency TEXT DEFAULT 'USD',
  imported_at TEXT NOT NULL,
  import_source TEXT,
  raw_text_hash TEXT,
  raw_text TEXT,
  match_status TEXT,
  match_confidence TEXT,
  matched_prediction_id TEXT,
  matched_strategy_ticket_id TEXT,
  recommendation_status TEXT,
  model_version_at_entry TEXT,
  checkpoint_at_entry TEXT,
  result TEXT DEFAULT 'OPEN',
  settled_return REAL,
  profit REAL,
  graded_at TEXT,
  void_reason TEXT,
  heritage_current_line REAL,
  heritage_current_price REAL,
  heritage_current_at TEXT,
  pin_entry_line REAL,
  pin_entry_price REAL,
  pin_entry_no_vig REAL,
  pin_close_line REAL,
  pin_close_price REAL,
  pin_close_no_vig REAL,
  clv REAL,
  clv_status TEXT,
  clv_method_version TEXT,
  attribution_label TEXT,
  UNIQUE (execution_book, external_ticket_id)
);

CREATE TABLE IF NOT EXISTS executed_bet_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bet_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_observations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  sport TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  season INTEGER,
  partition_key TEXT,
  observed_at TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  schema_version TEXT,
  record_count INTEGER,
  content_hash TEXT,
  r2_key TEXT,
  status TEXT,
  job_run_id TEXT,
  meta_json TEXT
);

CREATE TABLE IF NOT EXISTS team_feature_snapshots (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  team_id TEXT NOT NULL,
  season INTEGER,
  as_of TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  features_json TEXT,
  missingness_json TEXT,
  content_hash TEXT,
  job_run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_feature_snapshots (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  game_id TEXT NOT NULL,
  home_team_id TEXT,
  away_team_id TEXT,
  scheduled_start TEXT,
  feature_cutoff TEXT NOT NULL,
  source_obs_json TEXT,
  source_versions_json TEXT,
  feature_schema_version TEXT,
  model_version TEXT,
  neutral INTEGER,
  missingness_json TEXT,
  data_quality REAL,
  content_hash TEXT,
  job_run_id TEXT,
  features_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_registry (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  name TEXT,
  version TEXT,
  role TEXT NOT NULL DEFAULT 'shadow',
  family TEXT,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  market_informed INTEGER NOT NULL DEFAULT 0,
  artifact_id TEXT,
  criteria_json TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'shadow'
);

CREATE TABLE IF NOT EXISTS model_artifacts (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  schema_json TEXT,
  coefficients_json TEXT,
  training_cutoff TEXT,
  training_hash TEXT,
  source_versions_json TEXT,
  validation_key TEXT,
  expected_units_json TEXT,
  r2_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_predictions (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  game_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT,
  role TEXT NOT NULL DEFAULT 'shadow',
  feature_snapshot_id TEXT,
  proj_home REAL,
  proj_away REAL,
  proj_margin REAL,
  proj_total REAL,
  p_home_win REAL,
  p_cover REAL,
  p_over REAL,
  sigma_margin REAL,
  sigma_total REAL,
  market_informed INTEGER DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  frozen_at TEXT NOT NULL,
  content_hash TEXT,
  actual_home REAL,
  actual_away REAL,
  graded_at TEXT,
  grade_json TEXT
);

CREATE TABLE IF NOT EXISTS model_validation_runs (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  method TEXT,
  train_until TEXT,
  validate_from TEXT,
  validate_until TEXT,
  n INTEGER,
  metrics_json TEXT,
  leakage_ok INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_promotion_decisions (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  operator_approved INTEGER NOT NULL DEFAULT 0,
  criteria_json TEXT,
  evidence_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  month TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  records_returned INTEGER,
  quota_cost INTEGER,
  ok INTEGER,
  reason TEXT,
  query_keys TEXT,
  elapsed_ms INTEGER
);

CREATE TABLE IF NOT EXISTS team_season_identity (
  canonical_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  season INTEGER NOT NULL,
  source_team_id TEXT,
  espn_id TEXT,
  school TEXT,
  display_name TEXT,
  abbr TEXT,
  conference TEXT,
  classification TEXT,
  aliases_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (canonical_id, season)
);

CREATE TABLE IF NOT EXISTS mlb_market_projections (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  date TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  period TEXT NOT NULL,
  market_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  subject_name TEXT,
  team_id TEXT,
  opponent_id TEXT,
  line REAL,
  p_over REAL,
  p_under REAL,
  average REAL,
  projected_home REAL,
  projected_away REAL,
  p_home REAL,
  p_away REAL,
  source TEXT NOT NULL,
  source_market_key TEXT,
  source_market_name TEXT,
  source_as_of TEXT,
  source_request_id TEXT,
  model_version TEXT,
  lineups_official INTEGER,
  frozen_at TEXT NOT NULL,
  book TEXT,
  book_line REAL,
  book_over_price REAL,
  book_under_price REAL,
  priced INTEGER NOT NULL DEFAULT 0,
  qualification_state TEXT NOT NULL DEFAULT 'PROP_WATCH',
  qualification_reason TEXT,
  actual_value REAL,
  result TEXT,
  graded_at TEXT
);
