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
  f5_actual_home REAL,
  f5_actual_away REAL,
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
  f5_actual_home REAL,
  f5_actual_away REAL,
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
  clv_version TEXT,
  model_probability REAL,
  probability_schema_version TEXT,
  expected_roi_formula_version TEXT,
  validation_timestamp TEXT,
  validation_result TEXT,
  validation_failure_reason TEXT,
  source_projection_id TEXT,
  market_snapshot_id TEXT,
  freeze_id TEXT,
  qualification_rule_version TEXT
);

CREATE TABLE IF NOT EXISTS ev_audit_records (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  sport TEXT,
  market TEXT,
  side TEXT,
  model_version TEXT,
  qualification_rule_version TEXT,
  freeze_at TEXT,
  stored_ev REAL,
  recomputed_ev REAL,
  anomaly_reason TEXT NOT NULL,
  root_cause TEXT,
  qualified INTEGER,
  entered_strategy INTEGER,
  disposition TEXT NOT NULL,
  inputs_json TEXT,
  created_at TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_ev_audit_entity ON ev_audit_records (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ev_audit_reason ON ev_audit_records (anomaly_reason, created_at);

CREATE TABLE IF NOT EXISTS strategy_ticket_probability_corrections (
  id TEXT PRIMARY KEY,
  original_ticket_id TEXT NOT NULL,
  reconstructed_model_probability REAL,
  reconstruction_source TEXT,
  reconstruction_status TEXT NOT NULL,
  reconstruction_reason TEXT,
  expected_roi_recomputed REAL,
  freeze_id TEXT,
  source_projection_id TEXT,
  market_snapshot_id TEXT,
  inputs_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prob_corrections_ticket
  ON strategy_ticket_probability_corrections (original_ticket_id, created_at);

CREATE TABLE IF NOT EXISTS strategy_qualification_attempts (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  sport TEXT,
  date TEXT,
  market TEXT,
  side TEXT,
  model_probability REAL,
  expected_roi REAL,
  validation_result TEXT NOT NULL,
  validation_failure_reason TEXT,
  freeze_id TEXT,
  source_projection_id TEXT,
  market_snapshot_id TEXT,
  canary INTEGER,
  created_at TEXT NOT NULL
);

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
    player_name TEXT,
    prop_type TEXT,
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
    prop_actual REAL,
    prop_stat_source TEXT,
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

CREATE TABLE IF NOT EXISTS qb_transfer_history (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  player_name TEXT,
  season INTEGER NOT NULL,
  source_school TEXT,
  source_team_id TEXT,
  destination_school TEXT,
  destination_team_id TEXT,
  position TEXT,
  transfer_date TEXT,
  games_started INTEGER,
  pass_attempts INTEGER,
  usage REAL,
  passing_ppa REAL,
  passing_wepa REAL,
  success_rate REAL,
  explosive_rate REAL,
  sack_rate REAL,
  turnover_rate REAL,
  ypa REAL,
  as_of TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'cfbd',
  source_obs_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qb_transfer_dest ON qb_transfer_history (season, destination_school);
CREATE INDEX IF NOT EXISTS idx_qb_transfer_player ON qb_transfer_history (player_id, season);

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


CREATE TABLE IF NOT EXISTS player_availability_observations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  sport TEXT NOT NULL,
  team_key TEXT NOT NULL,
  team_name TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  position TEXT,
  position_group TEXT,
  depth_rank INTEGER,
  status TEXT NOT NULL,
  practice_status TEXT,
  injury_detail TEXT,
  game_id TEXT,
  opponent_key TEXT,
  effective_from TEXT,
  source_updated_at TEXT,
  observed_at TEXT NOT NULL,
  source_url TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_availability_sport_team_time
  ON player_availability_observations (sport, team_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_availability_sport_player_time
  ON player_availability_observations (sport, player_name, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_availability_game
  ON player_availability_observations (game_id, observed_at DESC);


CREATE TABLE IF NOT EXISTS apify_sports_cost_ledger (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  run_id TEXT,
  sport TEXT,
  cost_basis TEXT NOT NULL DEFAULT 'ESTIMATED',
  estimated_total_usd REAL NOT NULL DEFAULT 0,
  actual_total_usd REAL,
  rows_returned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_apify_sports_cost_month ON apify_sports_cost_ledger(created_at, provider);

CREATE TABLE IF NOT EXISTS prizepicks_prop_observations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  projection_id TEXT,
  player_id TEXT,
  player_name TEXT,
  player_headshot_url TEXT,
  team TEXT,
  position TEXT,
  league TEXT,
  game_id TEXT,
  home_team TEXT,
  away_team TEXT,
  start_time TEXT,
  stat TEXT,
  line REAL,
  odds_tier TEXT,
  allowed_wager_types TEXT,
  duration TEXT,
  is_promo INTEGER NOT NULL DEFAULT 0,
  source_updated_at TEXT,
  board_time TEXT,
  collected_at TEXT NOT NULL,
  payload_json TEXT,
  UNIQUE(projection_id, source_updated_at, line, odds_tier)
);
CREATE INDEX IF NOT EXISTS idx_pp_props_sport_start ON prizepicks_prop_observations(sport, start_time);
CREATE INDEX IF NOT EXISTS idx_pp_props_player_stat ON prizepicks_prop_observations(player_name, stat, collected_at);


CREATE TABLE IF NOT EXISTS prizepicks_daily_acquisitions (
  ct_date TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  state TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'zen-studio/prizepicks-player-props',
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  actual_cost_usd REAL,
  rows_returned INTEGER,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_pp_daily_acq_state
  ON prizepicks_daily_acquisitions(state, started_at);


-- Canonical independent soccer history.
CREATE TABLE IF NOT EXISTS soccer_matches (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  league TEXT NOT NULL,
  season INTEGER NOT NULL,
  start_time TEXT,
  match_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'FINAL',
  home_team_key TEXT NOT NULL,
  home_team_id TEXT,
  home_team_name TEXT,
  away_team_key TEXT NOT NULL,
  away_team_id TEXT,
  away_team_name TEXT,
  home_score REAL NOT NULL,
  away_score REAL NOT NULL,
  home_shots REAL,
  away_shots REAL,
  home_shots_on_target REAL,
  away_shots_on_target REAL,
  home_possession REAL,
  away_possession REAL,
  home_corners REAL,
  away_corners REAL,
  home_xg REAL,
  away_xg REAL,
  home_ppda REAL,
  away_ppda REAL,
  home_deep_completions REAL,
  away_deep_completions REAL,
  home_expected_points REAL,
  away_expected_points REAL,
  advanced_source TEXT,
  advanced_observed_at TEXT,
  source TEXT NOT NULL DEFAULT 'espn',
  source_observed_at TEXT,
  provenance_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (league, event_id)
);
CREATE INDEX IF NOT EXISTS idx_soccer_matches_league_date ON soccer_matches (league, match_date, event_id);
CREATE INDEX IF NOT EXISTS idx_soccer_matches_league_season_date ON soccer_matches (league, season, match_date, event_id);

-- Persistent NFL team/player operating profiles.
-- Current state is mutable; source observations remain immutable in their source tables.

CREATE TABLE IF NOT EXISTS nfl_team_profiles (
  team_key TEXT PRIMARY KEY,
  team_name TEXT,
  espn_team_id TEXT,
  season INTEGER NOT NULL,
  head_coach TEXT,
  offensive_coordinator TEXT,
  defensive_coordinator TEXT,
  coach_source TEXT,
  roster_count INTEGER NOT NULL DEFAULT 0,
  injured_count INTEGER NOT NULL DEFAULT 0,
  out_count INTEGER NOT NULL DEFAULT 0,
  questionable_count INTEGER NOT NULL DEFAULT 0,
  doubtful_count INTEGER NOT NULL DEFAULT 0,
  limited_count INTEGER NOT NULL DEFAULT 0,
  practice_dnp_count INTEGER NOT NULL DEFAULT 0,
  next_game_id TEXT,
  next_game_start TEXT,
  next_opponent_key TEXT,
  next_site TEXT,
  days_rest REAL,
  short_week INTEGER NOT NULL DEFAULT 0,
  post_bye INTEGER NOT NULL DEFAULT 0,
  road_trip_game_number INTEGER,
  road_games_last_4 INTEGER,
  three_road_in_four INTEGER NOT NULL DEFAULT 0,
  travel_miles REAL,
  time_zones_crossed INTEGER,
  altitude_feet REAL,
  international INTEGER NOT NULL DEFAULT 0,
  schedule_stress_score REAL,
  schedule_flags_json TEXT,
  identity_json TEXT,
  updated_at TEXT NOT NULL,
  source_updated_at TEXT,
  source_json TEXT
);

CREATE TABLE IF NOT EXISTS nfl_player_profiles (
  player_key TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  position TEXT,
  jersey TEXT,
  roster_status TEXT,
  depth_rank INTEGER,
  role_label TEXT,
  last_known_snap_share REAL,
  health_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  practice_state TEXT,
  injury_detail TEXT,
  injury_onset_at TEXT,
  injury_type TEXT,
  injury_severity_class TEXT,
  expected_return_state TEXT,
  expected_snap_share REAL,
  state_confidence REAL,
  state_source TEXT,
  state_source_updated_at TEXT,
  last_game_played_at TEXT,
  last_game_snap_share REAL,
  replacement_json TEXT,
  active_confirmation_at TEXT,
  carried_state INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_nfl_player_profiles_team
  ON nfl_player_profiles(team_key, position, depth_rank);

CREATE INDEX IF NOT EXISTS idx_nfl_player_profiles_health
  ON nfl_player_profiles(health_state, updated_at);

CREATE TABLE IF NOT EXISTS nfl_team_schedule_profile (
  id TEXT PRIMARY KEY,
  season INTEGER NOT NULL,
  team_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  week INTEGER,
  season_type TEXT,
  start_time TEXT,
  home_team_key TEXT,
  away_team_key TEXT,
  opponent_key TEXT,
  site TEXT,
  venue_name TEXT,
  venue_city TEXT,
  neutral_site INTEGER NOT NULL DEFAULT 0,
  international INTEGER NOT NULL DEFAULT 0,
  days_rest REAL,
  short_week INTEGER NOT NULL DEFAULT 0,
  post_bye INTEGER NOT NULL DEFAULT 0,
  road_trip_game_number INTEGER,
  road_games_last_4 INTEGER,
  three_road_in_four INTEGER NOT NULL DEFAULT 0,
  travel_miles REAL,
  time_zones_crossed INTEGER,
  altitude_feet REAL,
  schedule_stress_score REAL,
  stress_flags_json TEXT,
  source_updated_at TEXT,
  raw_json TEXT,
  UNIQUE(season, team_key, event_id)
);

CREATE INDEX IF NOT EXISTS idx_nfl_team_schedule_profile_team_time
  ON nfl_team_schedule_profile(season, team_key, start_time);


CREATE TABLE IF NOT EXISTS nfl_team_profile_snapshots (
  id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  season INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nfl_team_profile_snapshots_time
  ON nfl_team_profile_snapshots(team_key, as_of DESC);

CREATE TABLE IF NOT EXISTS nfl_player_state_events (
  id TEXT PRIMARY KEY,
  player_key TEXT,
  player_name TEXT NOT NULL,
  team_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  health_state TEXT,
  practice_state TEXT,
  injury_detail TEXT,
  source TEXT NOT NULL,
  source_timestamp TEXT NOT NULL,
  evidence_rank INTEGER NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nfl_player_state_events_player
  ON nfl_player_state_events(player_key, source_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_nfl_player_state_events_team
  ON nfl_player_state_events(team_key, source_timestamp DESC);

CREATE TABLE IF NOT EXISTS nfl_team_coach_history (
  id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  season INTEGER NOT NULL,
  coach_name TEXT NOT NULL,
  role TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nfl_team_coach_history
  ON nfl_team_coach_history(team_key, observed_at DESC);

CREATE TABLE IF NOT EXISTS nfl_profile_sync_runs (
  id TEXT PRIMARY KEY,
  season INTEGER NOT NULL,
  team_key TEXT,
  status TEXT NOT NULL,
  source TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  roster_rows INTEGER NOT NULL DEFAULT 0,
  schedule_rows INTEGER NOT NULL DEFAULT 0,
  injury_rows INTEGER NOT NULL DEFAULT 0,
  player_rows_upserted INTEGER NOT NULL DEFAULT 0,
  schedule_rows_upserted INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_nfl_profile_sync_runs_time
  ON nfl_profile_sync_runs(started_at DESC, team_key);


-- Persistent MLB team/player state. Keep in sync with migration 0055.
CREATE TABLE IF NOT EXISTS mlb_team_profiles (
  team_id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  team_name TEXT NOT NULL,
  season INTEGER,
  as_of TEXT NOT NULL,
  roster_json TEXT NOT NULL,
  rotation_json TEXT,
  bullpen_json TEXT,
  lineup_json TEXT,
  schedule_json TEXT,
  profile_json TEXT NOT NULL,
  state_confidence REAL,
  source_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_team_profiles_key ON mlb_team_profiles(team_key);
CREATE INDEX IF NOT EXISTS idx_mlb_team_profiles_asof ON mlb_team_profiles(as_of DESC);

CREATE TABLE IF NOT EXISTS mlb_team_profile_snapshots (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  season INTEGER,
  as_of TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_team_profile_snapshots_team_time
  ON mlb_team_profile_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS mlb_player_state_profiles (
  player_id TEXT PRIMARY KEY,
  player_name TEXT NOT NULL,
  team_id TEXT,
  team_key TEXT,
  position TEXT,
  roster_status TEXT NOT NULL,
  as_of TEXT NOT NULL,
  state_source TEXT NOT NULL,
  carried_forward INTEGER NOT NULL DEFAULT 0,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_player_state_team
  ON mlb_player_state_profiles(team_id,roster_status);

CREATE TABLE IF NOT EXISTS mlb_pitcher_profiles (
  player_id TEXT PRIMARY KEY,
  player_name TEXT NOT NULL,
  team_id TEXT,
  team_key TEXT,
  as_of TEXT NOT NULL,
  innings_per_start REAL,
  batters_faced_per_inning REAL,
  expected_innings REAL,
  recent_velocity REAL,
  recent_pitch_mix_json TEXT,
  statcast_profile_json TEXT,
  profile_json TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_pitcher_profiles_team
  ON mlb_pitcher_profiles(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS mlb_hitter_profiles (
  player_id TEXT PRIMARY KEY,
  player_name TEXT NOT NULL,
  team_id TEXT,
  team_key TEXT,
  as_of TEXT NOT NULL,
  handedness TEXT,
  lineup_role TEXT,
  statcast_profile_json TEXT,
  profile_json TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_hitter_profiles_team
  ON mlb_hitter_profiles(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS mlb_team_schedule_items (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  game_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  opponent_id TEXT,
  opponent_key TEXT,
  home_away TEXT,
  game_type TEXT,
  series_description TEXT,
  series_game_number INTEGER,
  games_in_series INTEGER,
  completed INTEGER NOT NULL DEFAULT 0,
  rest_days REAL,
  day_after_night INTEGER NOT NULL DEFAULT 0,
  doubleheader INTEGER NOT NULL DEFAULT 0,
  consecutive_road_games INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlb_schedule_team_time
  ON mlb_team_schedule_items(team_id,start_time);
CREATE INDEX IF NOT EXISTS idx_mlb_schedule_game ON mlb_team_schedule_items(game_id);

CREATE TABLE IF NOT EXISTS mlb_profile_refresh_state (
  shard_key TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  status TEXT NOT NULL,
  teams_processed INTEGER NOT NULL DEFAULT 0,
  players_processed INTEGER NOT NULL DEFAULT 0,
  source_calls INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  cursor_json TEXT,
  details_json TEXT,
  updated_at TEXT NOT NULL
);


-- SOCCER-FBIS-v3 PitchAPI research feature store (migration 0057).
-- SOCCER-FBIS-v3 PitchAPI research feature store.
-- Market-free football observations only. Historical actual lineups are stored
-- with post_match=1 and are never eligible as pre-kick lineup evidence.

CREATE TABLE IF NOT EXISTS soccer_pitchapi_match_features (
  pitch_match_id TEXT PRIMARY KEY,
  fbis_event_id TEXT,
  league_key TEXT NOT NULL,
  pitch_league_id TEXT,
  pitch_league_name TEXT,
  season TEXT,
  match_date TEXT NOT NULL,
  start_time TEXT,
  status TEXT,
  home_team_id TEXT NOT NULL,
  home_team_name TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  away_team_name TEXT NOT NULL,
  home_score REAL,
  away_score REAL,
  home_xg REAL,
  away_xg REAL,
  home_xgot REAL,
  away_xgot REAL,
  home_shots INTEGER,
  away_shots INTEGER,
  home_sot INTEGER,
  away_sot INTEGER,
  home_big_chances REAL,
  away_big_chances REAL,
  home_ppda REAL,
  away_ppda REAL,
  home_field_tilt REAL,
  away_field_tilt REAL,
  home_final_third_entries REAL,
  away_final_third_entries REAL,
  home_box_entries REAL,
  away_box_entries REAL,
  home_high_turnovers REAL,
  away_high_turnovers REAL,
  home_counterpress_regains REAL,
  away_counterpress_regains REAL,
  home_ball_recovery_time REAL,
  away_ball_recovery_time REAL,
  home_xt REAL,
  away_xt REAL,
  home_vaep REAL,
  away_vaep REAL,
  home_progressive_passes REAL,
  away_progressive_passes REAL,
  home_progressive_carries REAL,
  away_progressive_carries REAL,
  home_xag REAL,
  away_xag REAL,
  home_possession REAL,
  away_possession REAL,
  home_passes_per_sequence REAL,
  away_passes_per_sequence REAL,
  home_direct_speed REAL,
  away_direct_speed REAL,
  source_observed_at TEXT NOT NULL,
  raw_advanced_json TEXT,
  raw_stats_json TEXT,
  raw_shots_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pitchapi_soccer_league_date
  ON soccer_pitchapi_match_features(league_key,match_date,pitch_match_id);
CREATE INDEX IF NOT EXISTS idx_pitchapi_soccer_home_date
  ON soccer_pitchapi_match_features(home_team_id,match_date);
CREATE INDEX IF NOT EXISTS idx_pitchapi_soccer_away_date
  ON soccer_pitchapi_match_features(away_team_id,match_date);

CREATE TABLE IF NOT EXISTS soccer_pitchapi_player_match (
  id TEXT PRIMARY KEY,
  pitch_match_id TEXT NOT NULL,
  league_key TEXT NOT NULL,
  match_date TEXT NOT NULL,
  team_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT,
  minutes_played REAL,
  actions REAL,
  xt_total REAL,
  vaep_total REAL,
  xag REAL,
  xg_chain REAL,
  xg_buildup REAL,
  progressive_passes REAL,
  progressive_carries REAL,
  chances_created REAL,
  shots REAL,
  source_observed_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(pitch_match_id,player_id)
);
CREATE INDEX IF NOT EXISTS idx_pitchapi_player_history
  ON soccer_pitchapi_player_match(player_id,match_date);
CREATE INDEX IF NOT EXISTS idx_pitchapi_player_team_date
  ON soccer_pitchapi_player_match(team_id,match_date);

CREATE TABLE IF NOT EXISTS soccer_pitchapi_lineup_observations (
  id TEXT PRIMARY KEY,
  pitch_match_id TEXT NOT NULL,
  league_key TEXT NOT NULL,
  team_id TEXT NOT NULL,
  side TEXT NOT NULL,
  kickoff_time TEXT,
  observed_at TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  lineup_type TEXT,
  formation TEXT,
  starters_json TEXT NOT NULL,
  subs_json TEXT,
  coach_name TEXT,
  pre_match INTEGER NOT NULL DEFAULT 0,
  post_match INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pitchapi_lineup_match_time
  ON soccer_pitchapi_lineup_observations(pitch_match_id,observed_at);
CREATE INDEX IF NOT EXISTS idx_pitchapi_lineup_team_time
  ON soccer_pitchapi_lineup_observations(team_id,observed_at);

CREATE TABLE IF NOT EXISTS soccer_pitchapi_sync_runs (
  id TEXT PRIMARY KEY,
  league_key TEXT,
  pitch_league_id TEXT,
  season TEXT,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  matches_seen INTEGER NOT NULL DEFAULT 0,
  matches_persisted INTEGER NOT NULL DEFAULT 0,
  players_persisted INTEGER NOT NULL DEFAULT 0,
  lineups_persisted INTEGER NOT NULL DEFAULT 0,
  analytics_unavailable INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_pitchapi_sync_runs_time
  ON soccer_pitchapi_sync_runs(started_at DESC,league_key);



-- Heritage x PitchAPI coverage + restartable queue (migration 0059).
-- Timeout-safe Heritage x PitchAPI soccer coverage and backfill control.
CREATE TABLE IF NOT EXISTS soccer_competition_coverage (
  heritage_name TEXT PRIMARY KEY,
  heritage_key TEXT,
  offering_tier TEXT NOT NULL DEFAULT 'DISCOVERY',
  model_eligible INTEGER,
  policy_reason TEXT,
  pitch_league_id TEXT,
  pitch_league_name TEXT,
  pitch_country_code TEXT,
  match_score REAL,
  match_method TEXT,
  seasons_json TEXT,
  current_season TEXT,
  pitch_match_count INTEGER NOT NULL DEFAULT 0,
  advanced_rows INTEGER NOT NULL DEFAULT 0,
  advanced_coverage REAL,
  history_start TEXT,
  history_end TEXT,
  discovery_status TEXT NOT NULL DEFAULT 'PENDING',
  validation_status TEXT NOT NULL DEFAULT 'NOT_RUN',
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  last_discovered_at TEXT,
  last_ingested_at TEXT,
  last_live_sync_at TEXT,
  live_sync_errors INTEGER NOT NULL DEFAULT 0,
  live_sync_last_error TEXT,
  last_validation_at TEXT,
  validation_n INTEGER NOT NULL DEFAULT 0,
  validation_brier REAL,
  validation_log_loss REAL,
  validation_accuracy REAL,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_soccer_coverage_status
  ON soccer_competition_coverage(discovery_status,offering_tier,heritage_name);
CREATE INDEX IF NOT EXISTS idx_soccer_coverage_pitch
  ON soccer_competition_coverage(pitch_league_id);

CREATE TABLE IF NOT EXISTS soccer_pitchapi_backfill_queue (
  id TEXT PRIMARY KEY,
  heritage_name TEXT NOT NULL,
  heritage_key TEXT,
  pitch_league_id TEXT NOT NULL,
  season TEXT NOT NULL,
  offset INTEGER NOT NULL DEFAULT 0,
  page_size INTEGER NOT NULL DEFAULT 8,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  matches_seen INTEGER NOT NULL DEFAULT 0,
  matches_persisted INTEGER NOT NULL DEFAULT 0,
  analytics_unavailable INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(pitch_league_id,season,offset)
);
CREATE INDEX IF NOT EXISTS idx_soccer_backfill_queue_status
  ON soccer_pitchapi_backfill_queue(status,updated_at);
CREATE INDEX IF NOT EXISTS idx_soccer_backfill_queue_league
  ON soccer_pitchapi_backfill_queue(pitch_league_id,season,offset);

CREATE TABLE IF NOT EXISTS soccer_pitchapi_discovery_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  heritage_offerings INTEGER NOT NULL DEFAULT 0,
  pitch_leagues INTEGER NOT NULL DEFAULT 0,
  exact_matches INTEGER NOT NULL DEFAULT 0,
  fuzzy_matches INTEGER NOT NULL DEFAULT 0,
  unmatched INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT
);



-- Per-competition soccer validation ledger (migration 0061).
CREATE TABLE IF NOT EXISTS soccer_competition_validation (
  id TEXT PRIMARY KEY,
  heritage_name TEXT NOT NULL,
  heritage_key TEXT NOT NULL,
  model_version TEXT NOT NULL,
  sample_n INTEGER NOT NULL DEFAULT 0,
  v2_accuracy REAL,
  v2_brier REAL,
  v2_log_loss REAL,
  v3_accuracy REAL,
  v3_brier REAL,
  v3_log_loss REAL,
  delta_accuracy REAL,
  delta_brier REAL,
  delta_log_loss REAL,
  advanced_coverage REAL,
  historical_gate TEXT NOT NULL DEFAULT 'NOT_RUN',
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  evaluated_at TEXT NOT NULL,
  meta_json TEXT,
  UNIQUE(heritage_key,model_version)
);
CREATE INDEX IF NOT EXISTS idx_soccer_comp_validation_gate ON soccer_competition_validation(historical_gate,sample_n);


-- NFL QB personnel prospective shadow + NFL prop calibration/state freeze (migration 0065).
-- NFL prospective QB-personnel shadow + point-in-time prop state freeze.
-- Shadow rows are append-only. They never modify the NFL-PRO champion or wager authority.

CREATE TABLE IF NOT EXISTS nfl_qb_personnel_shadow_predictions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  season INTEGER,
  week INTEGER,
  start_time TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  frozen_at TEXT NOT NULL,

  champion_governance_id TEXT NOT NULL,
  incumbent_model_id TEXT,
  incumbent_model_version TEXT,
  incumbent_home REAL NOT NULL,
  incumbent_away REAL NOT NULL,
  incumbent_margin REAL NOT NULL,
  incumbent_win_probability REAL,
  incumbent_total REAL NOT NULL,

  challenger_model_id TEXT NOT NULL,
  challenger_home REAL NOT NULL,
  challenger_away REAL NOT NULL,
  challenger_margin REAL NOT NULL,
  challenger_win_probability REAL,
  challenger_total REAL NOT NULL,
  margin_correction REAL NOT NULL DEFAULT 0,

  combined_qb_burden REAL NOT NULL,
  home_qb_burden REAL NOT NULL,
  away_qb_burden REAL NOT NULL,
  gate_threshold REAL NOT NULL,
  gate_fired INTEGER NOT NULL DEFAULT 0,

  executable_market_json TEXT,
  home_profile_json TEXT,
  away_profile_json TEXT,
  personnel_json TEXT,
  provenance_json TEXT NOT NULL,

  actual_home REAL,
  actual_away REAL,
  actual_margin REAL,
  actual_total REAL,
  closing_market_json TEXT,
  incumbent_margin_abs_error REAL,
  challenger_margin_abs_error REAL,
  incumbent_winner_correct INTEGER,
  challenger_winner_correct INTEGER,
  incumbent_brier REAL,
  challenger_brier REAL,
  incumbent_log_loss REAL,
  challenger_log_loss REAL,
  incumbent_ats_result TEXT,
  challenger_ats_result TEXT,
  incumbent_roi_units REAL,
  challenger_roi_units REAL,
  incumbent_clv REAL,
  challenger_clv REAL,
  graded_at TEXT,

  lifecycle TEXT NOT NULL DEFAULT 'SHADOW',
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(event_id, checkpoint)
);

CREATE INDEX IF NOT EXISTS idx_nfl_qb_shadow_start
  ON nfl_qb_personnel_shadow_predictions(start_time, graded_at);
CREATE INDEX IF NOT EXISTS idx_nfl_qb_shadow_gate
  ON nfl_qb_personnel_shadow_predictions(gate_fired, start_time);
CREATE INDEX IF NOT EXISTS idx_nfl_qb_shadow_week
  ON nfl_qb_personnel_shadow_predictions(season, week, checkpoint);

CREATE TABLE IF NOT EXISTS nfl_prop_state_snapshots (
  id TEXT PRIMARY KEY,
  prop_line_id TEXT NOT NULL UNIQUE,
  run_id TEXT,
  projection_id TEXT,
  event_id TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team_key TEXT,
  market TEXT,
  line REAL,
  odds_tier TEXT,
  line_observed_at TEXT,
  collected_at TEXT NOT NULL,

  health_state TEXT,
  practice_state TEXT,
  injury_detail TEXT,
  injury_type TEXT,
  injury_severity_class TEXT,
  expected_return_state TEXT,
  last_known_snap_share REAL,
  expected_snap_share REAL,
  depth_rank INTEGER,
  role_label TEXT,
  state_confidence REAL,
  carried_state INTEGER NOT NULL DEFAULT 0,
  state_source TEXT,
  state_source_updated_at TEXT,
  player_profile_updated_at TEXT,

  player_state_json TEXT,
  injury_evidence_json TEXT,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nfl_prop_state_player_time
  ON nfl_prop_state_snapshots(player_name, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_nfl_prop_state_event
  ON nfl_prop_state_snapshots(event_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_nfl_prop_state_market
  ON nfl_prop_state_snapshots(market, collected_at DESC);

CREATE TABLE IF NOT EXISTS nfl_prop_market_calibration_runs (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT,
  evaluated_at TEXT NOT NULL,
  market TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  walk_forward_n INTEGER NOT NULL,
  bias REAL,
  empirical_sigma REAL,
  raw_brier REAL,
  raw_log_loss REAL,
  raw_ece REAL,
  calibrated_brier REAL,
  calibrated_log_loss REAL,
  calibrated_ece REAL,
  monotonic INTEGER NOT NULL DEFAULT 0,
  validated INTEGER NOT NULL DEFAULT 0,
  validation_reason TEXT,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nfl_prop_calibration_market
  ON nfl_prop_market_calibration_runs(market, evaluated_at DESC);


-- NBA Phase 3C prospective evaluation exclusions and market-link audit (migration 0070).
CREATE TABLE IF NOT EXISTS nba_prospective_exclusions (
  code_sha TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  excluded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nba_prospective_market_links (
  id TEXT PRIMARY KEY,
  projection_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  prediction_timestamp TEXT NOT NULL,
  market_type TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_snapshot_rowid INTEGER,
  entry_line REAL,
  entry_price REAL,
  entry_no_vig REAL,
  entry_captured_at TEXT,
  close_snapshot_rowid INTEGER,
  close_line REAL,
  close_price REAL,
  close_no_vig REAL,
  close_captured_at TEXT,
  game_start TEXT,
  market_used_as_feature INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  linked_at TEXT NOT NULL,
  UNIQUE(projection_id,market_type,side)
);
CREATE INDEX IF NOT EXISTS idx_nba_prospective_market_links_game ON nba_prospective_market_links(game_id,prediction_timestamp);
CREATE INDEX IF NOT EXISTS idx_nba_prospective_market_links_projection ON nba_prospective_market_links(projection_id);


-- WNBA possession challenger prospective shadow schema
-- 0080_wnba_possession_challenger_shadow.sql
-- Prospective, point-in-time WNBA possession-aware challenger state.
-- Research-only. Incumbent WNBA-FBIS-v2 / WNBA-PLAYER-PROJ-v2 remain authoritative.

CREATE TABLE IF NOT EXISTS wnba_possession_challenger_coefficients (
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  target TEXT NOT NULL,
  intercept REAL NOT NULL,
  slope REAL NOT NULL,
  train_n INTEGER NOT NULL,
  source_checkpoint TEXT NOT NULL,
  source_generated_at TEXT,
  frozen_at TEXT NOT NULL,
  details_json TEXT,
  production_eligible INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(model_id,target)
);

CREATE TABLE IF NOT EXISTS wnba_team_possession_feature_snapshots (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  as_of TEXT NOT NULL,
  model_version TEXT NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  close_possessions REAL,
  close_ortg REAL,
  close_ortg_shrunk REAL,
  reconstructed_pace REAL,
  pace_stability REAL,
  lineup_net100 REAL,
  lineup_possessions REAL,
  lineup_duration_coverage REAL,
  substitution_resolution REAL,
  lineup_reliability REAL,
  feature_json TEXT NOT NULL,
  market_informed INTEGER NOT NULL DEFAULT 0,
  production_eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_team_possession_feature_team_time
  ON wnba_team_possession_feature_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS wnba_game_possession_challenger_shadow (
  id TEXT PRIMARY KEY,
  natural_key TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL,
  event_start TEXT,
  captured_at TEXT NOT NULL,
  feature_cutoff_timestamp TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  baseline_home REAL,
  baseline_away REAL,
  baseline_margin REAL,
  baseline_total REAL,
  challenger_home REAL,
  challenger_away REAL,
  challenger_margin REAL,
  challenger_total REAL,
  sigma_margin REAL,
  sigma_total REAL,
  home_feature_value REAL,
  away_feature_value REAL,
  feature_delta REAL,
  feature_reliability REAL,
  lineup_reliability REAL,
  feature_json TEXT NOT NULL,
  market_informed INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  actual_home REAL,
  actual_away REAL,
  baseline_margin_abs_error REAL,
  challenger_margin_abs_error REAL,
  baseline_total_abs_error REAL,
  challenger_total_abs_error REAL,
  winner_brier_baseline REAL,
  winner_brier_challenger REAL,
  graded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_possession_shadow_event
  ON wnba_game_possession_challenger_shadow(event_id,captured_at);
CREATE INDEX IF NOT EXISTS idx_wnba_possession_shadow_model_grade
  ON wnba_game_possession_challenger_shadow(model_id,graded_at,captured_at);

CREATE TABLE IF NOT EXISTS wnba_game_possession_market_shadow (
  id TEXT PRIMARY KEY,
  natural_key TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL,
  event_start TEXT,
  captured_at TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  market TEXT NOT NULL,
  side TEXT NOT NULL,
  line REAL,
  american_price REAL NOT NULL,
  sportsbook TEXT,
  market_observed_at TEXT,
  model_probability REAL,
  break_even_probability REAL,
  probability_edge REAL,
  expected_value REAL,
  research_decision TEXT NOT NULL,
  feature_reliability REAL,
  lineup_reliability REAL,
  result TEXT,
  win INTEGER,
  push INTEGER,
  units REAL,
  close_line REAL,
  close_price REAL,
  clv_line REAL,
  clv_price REAL,
  settled_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_possession_market_shadow_event
  ON wnba_game_possession_market_shadow(event_id,captured_at);
CREATE INDEX IF NOT EXISTS idx_wnba_possession_market_shadow_model
  ON wnba_game_possession_market_shadow(model_id,market,research_decision,settled_at);

CREATE TABLE IF NOT EXISTS wnba_player_opportunity_shadow (
  id TEXT PRIMARY KEY,
  natural_key TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL,
  event_start TEXT,
  captured_at TEXT NOT NULL,
  feature_cutoff_timestamp TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team_id TEXT,
  market_type TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  baseline_projection REAL,
  opportunity_projection REAL,
  sigma REAL,
  projected_minutes_mean REAL,
  projected_minutes_sd REAL,
  usage_mean REAL,
  usage_sd REAL,
  fga_mean REAL,
  fga_sd REAL,
  tpa_mean REAL,
  tpa_sd REAL,
  rebound_opp_mean REAL,
  rebound_opp_sd REAL,
  assist_opp_mean REAL,
  assist_opp_sd REAL,
  availability_verified INTEGER NOT NULL DEFAULT 0,
  expected_teammates_json TEXT,
  opportunity_json TEXT NOT NULL,
  market_informed INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  entry_line REAL,
  entry_observed_at TEXT,
  actual_value REAL,
  baseline_abs_error REAL,
  opportunity_abs_error REAL,
  graded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_player_opportunity_event
  ON wnba_player_opportunity_shadow(event_id,player_name,market_type,captured_at);
CREATE INDEX IF NOT EXISTS idx_wnba_player_opportunity_grade
  ON wnba_player_opportunity_shadow(graded_at,feature_cutoff_timestamp);

CREATE TABLE IF NOT EXISTS wnba_player_opportunity_validation (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  market_type TEXT NOT NULL,
  n INTEGER NOT NULL,
  baseline_mae REAL,
  opportunity_mae REAL,
  mae_delta REAL,
  availability_verified_n INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  decision TEXT NOT NULL DEFAULT 'CONTINUE_SHADOW',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wnba_possession_challenger_validation (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  validation_type TEXT NOT NULL,
  n INTEGER NOT NULL,
  baseline_margin_mae REAL,
  challenger_margin_mae REAL,
  margin_mae_delta REAL,
  baseline_total_mae REAL,
  challenger_total_mae REAL,
  total_mae_delta REAL,
  baseline_brier REAL,
  challenger_brier REAL,
  brier_delta REAL,
  lineup_reliability_threshold REAL,
  reliable_n INTEGER,
  details_json TEXT,
  decision TEXT NOT NULL DEFAULT 'CONTINUE_SHADOW',
  created_at TEXT NOT NULL
);

-- CBB Directory Phase B research/SHADOW schema (migration 0084)
-- CBB Persistent Directory Phase B: verified enrichment + PIT game-state overlays.
-- Research/SHADOW infrastructure only. No production, qualification, or wager authority.

CREATE TABLE IF NOT EXISTS cbb_player_provider_ids (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, provider TEXT NOT NULL, provider_player_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL, observed_at TEXT NOT NULL, confidence REAL NOT NULL,
  provenance_json TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(provider,provider_player_id)
);
CREATE INDEX IF NOT EXISTS idx_cbb_provider_player ON cbb_player_provider_ids(player_id);

CREATE TABLE IF NOT EXISTS cbb_roster_observations (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, team_id TEXT NOT NULL, season INTEGER NOT NULL,
  provider_player_id TEXT, canonical_name TEXT NOT NULL, position TEXT, class_year TEXT, height_text TEXT,
  observed_at TEXT NOT NULL, effective_at TEXT NOT NULL, ingested_at TEXT NOT NULL,
  source TEXT NOT NULL, provenance_json TEXT NOT NULL, confidence REAL NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0, supersedes_id TEXT, pit_eligible INTEGER NOT NULL DEFAULT 1,
  research_only INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_roster_obs_pit ON cbb_roster_observations(team_id,effective_at,observed_at);

CREATE TABLE IF NOT EXISTS cbb_rotation_observations (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, team_id TEXT NOT NULL, season INTEGER NOT NULL,
  as_of TEXT NOT NULL, games INTEGER, starts INTEGER, minutes REAL, minutes_per_game REAL,
  recent_minutes REAL, expected_minutes REAL, starter_evidence REAL, rotation_rank INTEGER,
  usage_rate REAL, source TEXT NOT NULL, provenance_json TEXT NOT NULL, confidence REAL NOT NULL,
  observed_at TEXT NOT NULL, effective_at TEXT NOT NULL, ingested_at TEXT NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0, supersedes_id TEXT, pit_eligible INTEGER NOT NULL DEFAULT 1,
  research_only INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_rotation_pit ON cbb_rotation_observations(team_id,effective_at,observed_at);

CREATE TABLE IF NOT EXISTS cbb_availability_observations (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, team_id TEXT NOT NULL, status TEXT NOT NULL,
  injury_status TEXT, observed_at TEXT NOT NULL, effective_at TEXT NOT NULL, ingested_at TEXT NOT NULL,
  source TEXT NOT NULL, provenance_json TEXT NOT NULL, confidence REAL NOT NULL, stale INTEGER NOT NULL DEFAULT 0,
  supersedes_id TEXT, pit_eligible INTEGER NOT NULL DEFAULT 1, research_only INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  CHECK(status IN ('AVAILABLE','QUESTIONABLE','DOUBTFUL','OUT','SUSPENDED','UNKNOWN'))
);
CREATE INDEX IF NOT EXISTS idx_cbb_availability_pit ON cbb_availability_observations(team_id,effective_at,observed_at);

CREATE TABLE IF NOT EXISTS cbb_team_context_observations (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL, season INTEGER NOT NULL, conference TEXT, head_coach TEXT,
  coach_tenure_start TEXT, venue_id TEXT, venue_name TEXT, venue_latitude REAL, venue_longitude REAL,
  hca_reference REAL, observed_at TEXT NOT NULL, effective_at TEXT NOT NULL, ingested_at TEXT NOT NULL,
  source TEXT NOT NULL, provenance_json TEXT NOT NULL, confidence REAL NOT NULL, stale INTEGER NOT NULL DEFAULT 0,
  supersedes_id TEXT, pit_eligible INTEGER NOT NULL DEFAULT 1, research_only INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_team_context_pit ON cbb_team_context_observations(team_id,effective_at,observed_at);

CREATE TABLE IF NOT EXISTS cbb_game_state_snapshots (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, season INTEGER NOT NULL, game_start TEXT NOT NULL,
  feature_cutoff TEXT NOT NULL, home_team_id TEXT NOT NULL, away_team_id TEXT NOT NULL,
  home_state_json TEXT NOT NULL, away_state_json TEXT NOT NULL, unresolved_json TEXT NOT NULL,
  temporal_integrity_ok INTEGER NOT NULL, post_tip_observations INTEGER NOT NULL DEFAULT 0,
  future_membership_leaks INTEGER NOT NULL DEFAULT 0, future_availability_leaks INTEGER NOT NULL DEFAULT 0,
  future_lineup_leaks INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL DEFAULT 'SHADOW',
  overlay_version TEXT NOT NULL DEFAULT 'FBIS-STATE-OVERLAY-v1',
  research_only INTEGER NOT NULL DEFAULT 1, can_influence_projection INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0, can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  provenance_json TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(game_id,feature_cutoff)
);
CREATE INDEX IF NOT EXISTS idx_cbb_game_state_cutoff ON cbb_game_state_snapshots(feature_cutoff,game_start);

CREATE TABLE IF NOT EXISTS cbb_shadow_challenger_definitions (
  id TEXT PRIMARY KEY, target TEXT NOT NULL, family TEXT NOT NULL, evidence_policy TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'SHADOW', overlay_version TEXT NOT NULL DEFAULT 'FBIS-STATE-OVERLAY-v1',
  can_influence_projection INTEGER NOT NULL DEFAULT 0, can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  UNIQUE(target,family)
);

-- CBB Directory Phase B population checkpoints (migration 0084)
CREATE TABLE IF NOT EXISTS cbb_directory_phase_b_runs (
  id TEXT PRIMARY KEY,
  season INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  status TEXT NOT NULL,
  canonical_teams INTEGER NOT NULL,
  stable_id_players INTEGER NOT NULL,
  unresolved_provisional_players INTEGER NOT NULL,
  ambiguous_identities INTEGER NOT NULL,
  transfer_links INTEGER NOT NULL,
  roster_teams INTEGER NOT NULL,
  roster_players INTEGER NOT NULL,
  rotation_players INTEGER NOT NULL,
  starter_evidence_players INTEGER NOT NULL,
  lineup_continuity_teams INTEGER NOT NULL,
  replacement_players INTEGER NOT NULL,
  schedule_teams INTEGER NOT NULL,
  game_state_snapshots INTEGER NOT NULL,
  verified_availability INTEGER NOT NULL,
  unknown_availability INTEGER NOT NULL,
  qa_json TEXT NOT NULL,
  source_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_phase_b_runs_time ON cbb_directory_phase_b_runs(observed_at DESC);


-- WTA official match-history + PIT state foundation (migration 0082)
CREATE TABLE IF NOT EXISTS tennis_official_matches (
  match_id TEXT PRIMARY KEY,
  tour TEXT NOT NULL, source TEXT NOT NULL, source_match_id TEXT NOT NULL,
  tournament_group_id TEXT, tournament_year INTEGER, tournament_name TEXT, tournament_level TEXT,
  round_code TEXT, match_time TEXT, surface TEXT, indoor_outdoor TEXT, venue TEXT,
  player1_id TEXT, player2_id TEXT, source_player1_id TEXT, source_player2_id TEXT,
  winner_id TEXT, source_winner_id TEXT, score_text TEXT, sets_json TEXT,
  player1_games INTEGER, player2_games INTEGER, player1_sets INTEGER, player2_sets INTEGER,
  duration_seconds INTEGER, player1_entry_rank INTEGER, player2_entry_rank INTEGER,
  completion_state TEXT NOT NULL DEFAULT 'UNKNOWN', result_reason TEXT,
  observed_at TEXT NOT NULL, effective_at TEXT, ingested_at TEXT NOT NULL,
  provenance_json TEXT NOT NULL, raw_artifact_key TEXT,
  UNIQUE(source,tour,source_match_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_official_matches_p1_time ON tennis_official_matches(tour,player1_id,match_time);
CREATE INDEX IF NOT EXISTS idx_tennis_official_matches_p2_time ON tennis_official_matches(tour,player2_id,match_time);
CREATE INDEX IF NOT EXISTS idx_tennis_official_matches_tournament ON tennis_official_matches(tour,tournament_year,tournament_group_id);
CREATE INDEX IF NOT EXISTS idx_tennis_official_matches_surface_time ON tennis_official_matches(tour,surface,match_time);
CREATE TABLE IF NOT EXISTS tennis_match_identity_review_queue (
  review_id TEXT PRIMARY KEY, source TEXT NOT NULL, tour TEXT NOT NULL, source_match_id TEXT,
  source_player_id TEXT, raw_name TEXT, reason TEXT NOT NULL, payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tennis_match_identity_review_open ON tennis_match_identity_review_queue(tour,status,created_at);
CREATE TABLE IF NOT EXISTS tennis_wta_shards (
  shard_key TEXT PRIMARY KEY, stream TEXT NOT NULL, year INTEGER, tournament_group_id TEXT,
  status TEXT NOT NULL, source_path TEXT, cursor_value TEXT,
  records_seen INTEGER NOT NULL DEFAULT 0, records_written INTEGER NOT NULL DEFAULT 0,
  unresolved_count INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0,
  checksum TEXT, raw_artifact_key TEXT, last_error TEXT, started_at TEXT, completed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tennis_wta_shards_stream_status ON tennis_wta_shards(stream,status,year);
