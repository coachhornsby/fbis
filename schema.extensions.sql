-- Additive schema extensions introduced after the original schema.sql baseline.
-- Fresh databases should apply migrations; this file keeps schema verification explicit.

CREATE TABLE IF NOT EXISTS published_projections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sport TEXT NOT NULL,
  game_id TEXT NOT NULL,
  game_date TEXT NOT NULL,
  start_time TEXT,
  model_version TEXT,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  published_by TEXT NOT NULL DEFAULT 'operator',
  UNIQUE (sport, game_id, model_version)
);

CREATE INDEX IF NOT EXISTS idx_published_projections_date
  ON published_projections (game_date, sport, published_at);
CREATE INDEX IF NOT EXISTS idx_published_projections_game
  ON published_projections (sport, game_id);

CREATE TABLE IF NOT EXISTS cfbd_endpoint_audit (
  id TEXT PRIMARY KEY,
  audited_at TEXT NOT NULL,
  season INTEGER,
  week INTEGER,
  job_run_id TEXT,
  summary_json TEXT,
  endpoints_json TEXT,
  catalog_version TEXT,
  feature_table_json TEXT,
  content_hash TEXT,
  r2_key TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cfbd_endpoint_audit_season
  ON cfbd_endpoint_audit (season, audited_at);

CREATE TABLE IF NOT EXISTS cfb_pregame_feature_vectors (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  season INTEGER,
  week INTEGER,
  kickoff_timestamp TEXT,
  home_team TEXT,
  away_team TEXT,
  feature_as_of_timestamp TEXT NOT NULL,
  feature_cutoff_timestamp TEXT NOT NULL,
  source_version TEXT,
  source_endpoint TEXT,
  collection_timestamp TEXT NOT NULL,
  features_json TEXT,
  decomposition_json TEXT,
  uncertainty_json TEXT,
  model_id TEXT,
  content_hash TEXT,
  job_run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cfb_pregame_feat_game
  ON cfb_pregame_feature_vectors (game_id, feature_cutoff_timestamp);

CREATE TABLE IF NOT EXISTS cfb_player_role_snapshots (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  season INTEGER,
  week INTEGER,
  season_type TEXT,
  kickoff_timestamp TEXT,
  team TEXT NOT NULL,
  side TEXT NOT NULL,
  role TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT,
  position TEXT,
  role_confidence REAL,
  identity_as_of TEXT NOT NULL,
  feature_cutoff_timestamp TEXT NOT NULL,
  selection_json TEXT,
  provenance_json TEXT,
  model_version TEXT,
  content_hash TEXT,
  job_run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cfb_player_role_game
  ON cfb_player_role_snapshots (game_id, role);

CREATE INDEX IF NOT EXISTS idx_cfb_player_role_team
  ON cfb_player_role_snapshots (team, season, week);

CREATE TABLE IF NOT EXISTS cfb_player_projections (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  season INTEGER,
  week INTEGER,
  kickoff_timestamp TEXT,
  team TEXT NOT NULL,
  side TEXT NOT NULL,
  role TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT,
  market_type TEXT NOT NULL,
  projection REAL,
  median REAL,
  sigma REAL,
  quantiles_json TEXT,
  data_quality REAL,
  sample_size INTEGER,
  uncertainty_state TEXT,
  model_id TEXT NOT NULL,
  model_version TEXT,
  game_model_id TEXT,
  game_model_version TEXT,
  feature_cutoff_timestamp TEXT NOT NULL,
  feature_as_of_timestamp TEXT,
  provenance_json TEXT,
  coherence_json TEXT,
  content_hash TEXT,
  job_run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cfb_player_proj_game
  ON cfb_player_projections (game_id, role, market_type);

CREATE TABLE IF NOT EXISTS cfb_prop_market_lines (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT,
  team TEXT,
  market_type TEXT NOT NULL,
  line REAL NOT NULL,
  over_price REAL,
  under_price REAL,
  source TEXT NOT NULL,
  sportsbook TEXT,
  observed_at TEXT NOT NULL,
  market_quality TEXT,
  import_mode TEXT,
  payload_json TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cfb_prop_market_game
  ON cfb_prop_market_lines (game_id, market_type, source);

CREATE TABLE IF NOT EXISTS cfb_player_prop_comparisons (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  projection_id TEXT,
  market_line_id TEXT,
  player_id TEXT,
  player_name TEXT,
  market_type TEXT NOT NULL,
  fbis_projection REAL,
  market_line REAL,
  difference REAL,
  standardized_diff REAL,
  probability_over REAL,
  probability_under REAL,
  source TEXT,
  correlation_tags_json TEXT,
  decision_eligible INTEGER NOT NULL DEFAULT 0,
  model_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cfb_player_prop_cmp_game
  ON cfb_player_prop_comparisons (game_id, market_type);

-- Action/Apify shadow market intelligence (research only; never production router).
-- Action Network / Apify SHADOW market intelligence storage.
-- Additive only. Never overwrites authoritative production markets.
-- Never grants canQualify / canAuthorizeWager. Never feeds CFB-FBIS-v2 features.

CREATE TABLE IF NOT EXISTS shadow_provider_runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  source_class TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  test_id TEXT,
  apify_run_id TEXT,
  dataset_id TEXT,
  status TEXT,
  leagues_json TEXT,
  periods_json TEXT,
  max_items INTEGER,
  optional_blocks_json TEXT,
  games_returned INTEGER,
  malformed_rows INTEGER,
  estimated_cost_usd REAL,
  actual_cost_usd REAL,
  budget_limit_usd REAL,
  budget_spent_usd REAL,
  input_json TEXT,
  usage_json TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shadow_provider_runs_provider
  ON shadow_provider_runs (provider, created_at);

CREATE TABLE IF NOT EXISTS shadow_market_observations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_class TEXT NOT NULL,
  action_game_id TEXT NOT NULL,
  league TEXT,
  season INTEGER,
  season_type TEXT,
  week INTEGER,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_abbr TEXT,
  away_abbr TEXT,
  start_time TEXT,
  status TEXT,
  is_live INTEGER,
  period TEXT,
  period_label TEXT,
  scraped_at TEXT,
  received_at TEXT,
  -- observed_at stays null unless Actor supplies a true source observation time.
  observed_at TEXT,
  source_url TEXT,
  raw_payload_hash TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  consensus_json TEXT,
  public_betting_json TEXT,
  market_quality_json TEXT,
  best_odds_json TEXT,
  line_movement_json TEXT,
  result_json TEXT,
  research_fields_json TEXT,
  decision_eligible INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES shadow_provider_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_shadow_market_obs_game
  ON shadow_market_observations (action_game_id, period);

CREATE INDEX IF NOT EXISTS idx_shadow_market_obs_league_start
  ON shadow_market_observations (league, start_time);

CREATE INDEX IF NOT EXISTS idx_shadow_market_obs_run
  ON shadow_market_observations (run_id);

CREATE TABLE IF NOT EXISTS shadow_market_books (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  action_game_id TEXT NOT NULL,
  book TEXT NOT NULL,
  book_id TEXT,
  period TEXT,
  market_id TEXT,
  is_live INTEGER,
  spread_home REAL,
  spread_home_odds REAL,
  spread_away REAL,
  spread_away_odds REAL,
  moneyline_home REAL,
  moneyline_away REAL,
  total REAL,
  over_odds REAL,
  under_odds REAL,
  moneyline_hold_percent REAL,
  spread_hold_percent REAL,
  total_hold_percent REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (observation_id) REFERENCES shadow_market_observations(id)
);

CREATE INDEX IF NOT EXISTS idx_shadow_market_books_obs
  ON shadow_market_books (observation_id, book);

CREATE TABLE IF NOT EXISTS shadow_market_splits (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  action_game_id TEXT NOT NULL,
  market TEXT NOT NULL,
  side TEXT NOT NULL,
  tickets_percent REAL,
  money_percent REAL,
  money_minus_tickets REAL,
  max_money_ticket_gap REAL,
  sharp_side TEXT,
  bet_count INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (observation_id) REFERENCES shadow_market_observations(id)
);

CREATE INDEX IF NOT EXISTS idx_shadow_market_splits_obs
  ON shadow_market_splits (observation_id, market, side);

CREATE TABLE IF NOT EXISTS shadow_line_movement (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  action_game_id TEXT NOT NULL,
  book TEXT,
  market TEXT,
  side TEXT,
  line REAL,
  odds REAL,
  -- Actor-supplied move timestamp only; never scrapedAt.
  observed_at TEXT,
  open_spread_home REAL,
  open_total REAL,
  open_moneyline_home REAL,
  current_spread_home REAL,
  current_total REAL,
  current_moneyline_home REAL,
  spread_move REAL,
  total_move REAL,
  spread_direction TEXT,
  total_direction TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (observation_id) REFERENCES shadow_market_observations(id)
);

CREATE INDEX IF NOT EXISTS idx_shadow_line_move_obs
  ON shadow_line_movement (observation_id, market);

CREATE TABLE IF NOT EXISTS shadow_provider_comparisons (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  game_match_rate REAL,
  matched_games INTEGER,
  action_games INTEGER,
  provider_games INTEGER,
  exact_spread_line_agreement REAL,
  exact_total_line_agreement REAL,
  ml_price_abs_diff_mean REAL,
  missing_on_action INTEGER,
  missing_on_provider INTEGER,
  unmatched_action_json TEXT,
  unmatched_provider_json TEXT,
  market_comparisons_json TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES shadow_provider_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_shadow_provider_cmp_run
  ON shadow_provider_comparisons (run_id, provider_name);

-- Action/Apify production-candidate operational tables (migration 0021)
-- Action/Apify PRODUCTION-CANDIDATE operational layer (additive).
-- Shadow/candidate only. Never grants canQualify / canAuthorizeWager.
-- Never enters ODDS_PROVIDER_ORDER. Never feeds CFB-FBIS-v2 features.

CREATE TABLE IF NOT EXISTS shadow_collection_runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'ACTION_APIFY',
  mode TEXT NOT NULL DEFAULT 'shadow',
  plan TEXT NOT NULL,
  profile TEXT NOT NULL,
  sport TEXT NOT NULL,
  lifecycle TEXT,
  status TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  overlap_blocked INTEGER NOT NULL DEFAULT 0,
  budget_blocked INTEGER NOT NULL DEFAULT 0,
  circuit_open INTEGER NOT NULL DEFAULT 0,
  apify_run_id TEXT,
  dataset_id TEXT,
  requested_max_items INTEGER,
  games_expected INTEGER,
  games_returned INTEGER,
  games_matched INTEGER,
  games_unmatched INTEGER,
  observations_written INTEGER,
  duplicates_skipped INTEGER,
  malformed_rows INTEGER,
  schema_fingerprint TEXT,
  schema_drift_level TEXT,
  estimated_cost_usd REAL,
  actual_cost_usd REAL,
  cost_basis TEXT,
  error_class TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shadow_collection_runs_sport_started
  ON shadow_collection_runs (sport, started_at);
CREATE INDEX IF NOT EXISTS idx_shadow_collection_runs_status
  ON shadow_collection_runs (status, started_at);

CREATE TABLE IF NOT EXISTS shadow_cost_ledger (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  sport TEXT,
  profile TEXT,
  cost_basis TEXT NOT NULL,
  run_start_usd REAL NOT NULL DEFAULT 0,
  scoreboard_usd REAL NOT NULL DEFAULT 0,
  row_usd REAL NOT NULL DEFAULT 0,
  movement_usd REAL NOT NULL DEFAULT 0,
  player_props_usd REAL NOT NULL DEFAULT 0,
  game_props_usd REAL NOT NULL DEFAULT 0,
  detail_usd REAL NOT NULL DEFAULT 0,
  weather_usd REAL NOT NULL DEFAULT 0,
  injuries_usd REAL NOT NULL DEFAULT 0,
  standings_usd REAL NOT NULL DEFAULT 0,
  futures_usd REAL NOT NULL DEFAULT 0,
  estimated_total_usd REAL NOT NULL DEFAULT 0,
  actual_total_usd REAL,
  delta_usd REAL,
  games_returned INTEGER,
  features_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES shadow_collection_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_shadow_cost_ledger_created
  ON shadow_cost_ledger (created_at);
CREATE INDEX IF NOT EXISTS idx_shadow_cost_ledger_run
  ON shadow_cost_ledger (run_id);

CREATE TABLE IF NOT EXISTS shadow_provider_reliability (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sport TEXT,
  profile TEXT,
  success INTEGER NOT NULL,
  http_status INTEGER,
  actor_failure INTEGER NOT NULL DEFAULT 0,
  api_failure INTEGER NOT NULL DEFAULT 0,
  malformed_payload INTEGER NOT NULL DEFAULT 0,
  empty_run INTEGER NOT NULL DEFAULT 0,
  partial_run INTEGER NOT NULL DEFAULT 0,
  schema_violation INTEGER NOT NULL DEFAULT 0,
  timeout INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  games_expected INTEGER,
  games_returned INTEGER,
  unmatched_games INTEGER,
  duplicate_rows INTEGER,
  error_class TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES shadow_collection_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_shadow_reliability_created
  ON shadow_provider_reliability (created_at);
CREATE INDEX IF NOT EXISTS idx_shadow_reliability_run
  ON shadow_provider_reliability (run_id);

CREATE TABLE IF NOT EXISTS shadow_schema_fingerprints (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  schema_version TEXT,
  fingerprint TEXT NOT NULL,
  top_level_keys_json TEXT,
  required_fields_json TEXT,
  drift_level TEXT NOT NULL,
  drift_notes_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shadow_schema_fp_created
  ON shadow_schema_fingerprints (created_at);

CREATE TABLE IF NOT EXISTS shadow_promotion_metrics (
  id TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  sport TEXT,
  readiness_status TEXT NOT NULL,
  coverage_json TEXT,
  accuracy_json TEXT,
  freshness_json TEXT,
  history_json TEXT,
  intelligence_json TEXT,
  reliability_json TEXT,
  economics_json TEXT,
  blockers_json TEXT,
  sample_sizes_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shadow_promotion_metrics_created
  ON shadow_promotion_metrics (created_at);

CREATE TABLE IF NOT EXISTS shadow_dead_letters (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  error_class TEXT NOT NULL,
  error_message TEXT,
  payload_hash TEXT,
  payload_excerpt TEXT,
  sport TEXT,
  profile TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shadow_dead_letters_created
  ON shadow_dead_letters (created_at);

-- Observation natural-key uniqueness helper for idempotent candidate upserts.
CREATE TABLE IF NOT EXISTS shadow_observation_keys (
  natural_key TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  action_game_id TEXT,
  market TEXT,
  period TEXT,
  book TEXT,
  source_observed_at TEXT,
  collected_at TEXT,
  payload_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shadow_obs_keys_game
  ON shadow_observation_keys (action_game_id, market, period, book);

-- Action/Apify candidate hardening (migration 0022)
-- Durable scheduler lease/circuit. Shadow/candidate only.

CREATE TABLE IF NOT EXISTS shadow_candidate_scheduler_state (
  provider TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  active_run_id TEXT,
  lease_acquired_at TEXT,
  lease_expires_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  circuit_open_until TEXT,
  last_run_id TEXT,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error_class TEXT,
  last_error_message TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_shadow_scheduler_lease_expires
  ON shadow_candidate_scheduler_state (lease_expires_at);

-- Canonical governance foundations (migration 0023)
CREATE TABLE IF NOT EXISTS canonical_source_registry (
  provider_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sports_json TEXT NOT NULL,
  domain TEXT NOT NULL,
  data_families_json TEXT NOT NULL,
  endpoint_or_feed TEXT,
  cadence TEXT,
  historical_coverage TEXT,
  commercial_status TEXT NOT NULL,
  priority INTEGER,
  fallback_priority INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  in_pure_model INTEGER NOT NULL DEFAULT 0,
  in_market_layer INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_model_registry (
  model_id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  family TEXT NOT NULL,
  display_name TEXT NOT NULL,
  maturity TEXT NOT NULL,
  role TEXT NOT NULL,
  artifact_ref TEXT,
  coefficients_locked INTEGER NOT NULL DEFAULT 0,
  calibration_locked INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  market_informed INTEGER NOT NULL DEFAULT 0,
  independent INTEGER NOT NULL DEFAULT 1,
  preserves_incumbent INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_feature_registry (
  feature_name TEXT NOT NULL,
  sport TEXT NOT NULL,
  model_family TEXT NOT NULL,
  provider_id TEXT,
  raw_field TEXT,
  normalized_field TEXT,
  transform_version TEXT,
  window TEXT,
  missing_rule TEXT,
  timestamp_rule TEXT,
  status TEXT NOT NULL,
  rationale TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (feature_name, sport, model_family)
);

CREATE TABLE IF NOT EXISTS canonical_provider_health (
  provider_id TEXT PRIMARY KEY,
  sport TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error_class TEXT,
  last_error_message TEXT,
  freshness_seconds INTEGER,
  coverage_ratio REAL,
  status TEXT NOT NULL DEFAULT 'UNKNOWN',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_misprice_snapshots (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  event_id TEXT,
  player_id TEXT,
  market_type TEXT NOT NULL,
  model_id TEXT,
  state TEXT NOT NULL,
  label TEXT NOT NULL,
  projection REAL,
  market_line REAL,
  disagreement_units REAL,
  model_probability REAL,
  expected_value REAL,
  can_show_ev INTEGER NOT NULL DEFAULT 0,
  information_cutoff TEXT,
  market_timestamp TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_governance_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);


-- ACTION immutable observation time series (migration 0024)
CREATE TABLE IF NOT EXISTS action_market_book_observations (
  id TEXT PRIMARY KEY,
  observation_key TEXT NOT NULL UNIQUE,
  canonical_event_id TEXT,
  canonical_player_id TEXT,
  provider_event_id TEXT NOT NULL,
  provider_player_id TEXT,
  sport TEXT NOT NULL,
  market_type TEXT NOT NULL,
  market_period TEXT NOT NULL DEFAULT 'event',
  selection TEXT NOT NULL,
  line REAL,
  american_price REAL,
  sportsbook TEXT NOT NULL,
  provider_timestamp TEXT,
  collected_at TEXT NOT NULL,
  event_start_time TEXT,
  snapshot_type TEXT,
  public_ticket_pct REAL,
  public_money_pct REAL,
  money_minus_ticket_pct REAL,
  tracked_bet_count REAL,
  tracked_volume REAL,
  raw_payload_hash TEXT NOT NULL,
  match_confidence TEXT,
  schema_version TEXT NOT NULL,
  run_id TEXT,
  source_observation_id TEXT,
  decision_eligible INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_action_book_obs_event_market
  ON action_market_book_observations (canonical_event_id, market_type, market_period, selection, sportsbook, collected_at);
CREATE INDEX IF NOT EXISTS idx_action_book_obs_provider_event
  ON action_market_book_observations (provider_event_id, sport, collected_at);
CREATE INDEX IF NOT EXISTS idx_action_book_obs_player
  ON action_market_book_observations (canonical_player_id, market_type, collected_at);
CREATE INDEX IF NOT EXISTS idx_action_book_obs_snapshot
  ON action_market_book_observations (snapshot_type, sport, collected_at);
CREATE INDEX IF NOT EXISTS idx_action_book_obs_run
  ON action_market_book_observations (run_id);

CREATE TABLE IF NOT EXISTS action_market_snapshot_pointers (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  canonical_event_id TEXT,
  canonical_player_id TEXT,
  provider_event_id TEXT NOT NULL,
  provider_player_id TEXT,
  market_type TEXT NOT NULL,
  market_period TEXT NOT NULL DEFAULT 'event',
  selection TEXT NOT NULL,
  sportsbook TEXT NOT NULL,
  snapshot_type TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  observation_key TEXT NOT NULL,
  derived_at TEXT NOT NULL,
  event_start_time TEXT,
  FOREIGN KEY (observation_id) REFERENCES action_market_book_observations(id)
);

CREATE INDEX IF NOT EXISTS idx_action_snap_ptr_event
  ON action_market_snapshot_pointers (canonical_event_id, market_type, snapshot_type);
CREATE INDEX IF NOT EXISTS idx_action_snap_ptr_type
  ON action_market_snapshot_pointers (snapshot_type, sport, derived_at);

-- Manual-completion contracts (migration 0025)
CREATE TABLE IF NOT EXISTS canonical_publication_ledger (
  publication_id TEXT PRIMARY KEY,
  projection_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT,
  sport TEXT,
  event_id TEXT,
  market_snapshot_id TEXT,
  published_value_json TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT 'internal',
  validation_status TEXT,
  publication_status TEXT NOT NULL,
  commercial_status TEXT,
  supersedes_publication_id TEXT,
  published_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_canonical_publication_projection
  ON canonical_publication_ledger (projection_id, published_at);
CREATE INDEX IF NOT EXISTS idx_canonical_publication_sport_status
  ON canonical_publication_ledger (sport, publication_status, published_at);

CREATE TABLE IF NOT EXISTS canonical_dq_findings (
  id TEXT PRIMARY KEY,
  reason_code TEXT NOT NULL,
  severity TEXT NOT NULL,
  sport TEXT,
  event_id TEXT,
  player_id TEXT,
  market_type TEXT,
  message TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_canonical_dq_severity
  ON canonical_dq_findings (severity, sport, created_at);

CREATE TABLE IF NOT EXISTS canonical_probability_provenance (
  id TEXT PRIMARY KEY,
  projection_id TEXT,
  probability_source TEXT NOT NULL,
  model_family TEXT,
  model_id TEXT,
  model_version TEXT,
  distribution_model_id TEXT,
  distribution_model_version TEXT,
  calibrator_id TEXT,
  calibrator_version TEXT,
  validation_status TEXT,
  oos_sample_size INTEGER,
  information_cutoff TEXT,
  generated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_canonical_prob_proj
  ON canonical_probability_provenance (projection_id, generated_at);

CREATE TABLE IF NOT EXISTS canonical_promotion_evidence (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  artifact_ref TEXT,
  artifact_content_hash TEXT,
  training_hash TEXT,
  feature_manifest_id TEXT,
  fold_scheme TEXT,
  oos_n INTEGER,
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL,
  operator_decision TEXT,
  auto_promote INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_canonical_promotion_model
  ON canonical_promotion_evidence (model_id, model_version, created_at);

CREATE TABLE IF NOT EXISTS canonical_runtime_version (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
