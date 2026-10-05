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

-- Durable ACTION ↔ FBIS event identity links (migration 0026)
-- Append/upsert identity only — never mutates immutable market observations.
CREATE TABLE IF NOT EXISTS action_event_identity_links (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'ACTION_APIFY',
  provider_event_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  canonical_event_id TEXT NOT NULL,
  match_confidence TEXT NOT NULL,
  match_reason TEXT,
  source_observation_id TEXT,
  linked_at TEXT NOT NULL,
  UNIQUE (provider, provider_event_id, sport)
);
CREATE INDEX IF NOT EXISTS idx_action_identity_canonical
  ON action_event_identity_links (canonical_event_id, sport);
CREATE INDEX IF NOT EXISTS idx_action_identity_provider
  ON action_event_identity_links (provider_event_id, sport);



-- Persistent model-learning findings (migration 0027)
CREATE TABLE IF NOT EXISTS model_learning_findings (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  model_id TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  slice_key TEXT,
  metric TEXT NOT NULL,
  baseline_n INTEGER,
  recent_n INTEGER,
  baseline_value REAL,
  recent_value REAL,
  delta REAL,
  severity TEXT NOT NULL,
  window_start TEXT,
  window_end TEXT,
  evidence_json TEXT NOT NULL,
  hypothesis TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_model_learning_findings_model
  ON model_learning_findings (sport, model_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_model_learning_findings_severity
  ON model_learning_findings (severity, created_at);


-- PrizePicks targeted execution-line feed (migration 0032)
CREATE TABLE IF NOT EXISTS prizepicks_prop_lines (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  projection_id TEXT,
  fbis_event_id TEXT,
  sport TEXT NOT NULL,
  league TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  opponent TEXT,
  game_id TEXT,
  start_time TEXT,
  stat_type TEXT NOT NULL,
  canonical_market TEXT,
  line REAL NOT NULL,
  odds_tier TEXT,
  duration TEXT,
  fbis_projection REAL,
  fbis_sigma REAL,
  delta_fbis_minus_line REAL,
  candidate_side TEXT,
  observed_at TEXT,
  collected_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prizepicks_prop_lines_sport_time
  ON prizepicks_prop_lines(sport, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_prizepicks_prop_lines_event
  ON prizepicks_prop_lines(fbis_event_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_prizepicks_prop_lines_player_market
  ON prizepicks_prop_lines(player_name, canonical_market, collected_at DESC);


-- FBIS operational control plane (migration 0037)
CREATE TABLE IF NOT EXISTS fbis_ops_components (
  component_id TEXT PRIMARY KEY,
  component_name TEXT NOT NULL,
  component_type TEXT NOT NULL,
  sport_or_domain TEXT,
  provider TEXT,
  criticality TEXT NOT NULL DEFAULT 'standard',
  expected_cadence_minutes INTEGER,
  grace_period_minutes INTEGER,
  stale_after_minutes INTEGER,
  escalation_after_minutes INTEGER,
  paid_provider INTEGER NOT NULL DEFAULT 0,
  health_endpoint TEXT,
  target_table TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fbis_ops_health (
  component_id TEXT PRIMARY KEY,
  workflow_freshness_at TEXT,
  source_freshness_at TEXT,
  database_freshness_at TEXT,
  published_freshness_at TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_nonempty_at TEXT,
  last_persist_at TEXT,
  last_verified_at TEXT,
  source_rows INTEGER,
  rows_written INTEGER,
  rows_visible_downstream INTEGER,
  status TEXT NOT NULL DEFAULT 'UNKNOWN',
  severity TEXT NOT NULL DEFAULT 'INFO',
  incident_fingerprint TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_empty_successes INTEGER NOT NULL DEFAULT 0,
  last_error_class TEXT,
  last_error TEXT,
  provider_run_id TEXT,
  workflow_run_id TEXT,
  deployment_sha TEXT,
  data_date_or_range TEXT,
  cost_or_quota_state TEXT,
  metadata_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fbis_run_manifests (
  run_id TEXT PRIMARY KEY,
  component_id TEXT NOT NULL,
  workflow_run_id TEXT,
  provider_run_id TEXT,
  trigger_type TEXT,
  expected_range TEXT,
  expected_items INTEGER,
  received_items INTEGER,
  persisted_items INTEGER,
  visible_items INTEGER,
  rejected_items INTEGER,
  duplicate_items INTEGER,
  started_at TEXT,
  finished_at TEXT,
  status TEXT NOT NULL,
  error_class TEXT,
  error_summary TEXT,
  deployment_sha TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fbis_ops_invariant_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invariant_key TEXT NOT NULL,
  component_id TEXT,
  checked_at TEXT NOT NULL,
  status TEXT NOT NULL,
  expected_value TEXT,
  actual_value TEXT,
  detail TEXT,
  incident_fingerprint TEXT,
  metadata_json TEXT
);
CREATE TABLE IF NOT EXISTS fbis_watchdog_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_fingerprint TEXT NOT NULL,
  component_id TEXT,
  failure_class TEXT,
  severity TEXT,
  detected_at TEXT NOT NULL,
  repaired_at TEXT,
  verified_at TEXT,
  detection_source TEXT,
  autonomous_repair INTEGER NOT NULL DEFAULT 0,
  owner_action_required INTEGER NOT NULL DEFAULT 0,
  repeat_count INTEGER NOT NULL DEFAULT 1,
  mttr_seconds INTEGER,
  notes TEXT,
  UNIQUE(incident_fingerprint, detected_at)
);


-- Continuous learning governance tiers 1-5 (migration 0038).
CREATE TABLE IF NOT EXISTS learning_monitor_runs (
  id TEXT PRIMARY KEY, sport TEXT NOT NULL, model_id TEXT NOT NULL,
  observed_n INTEGER NOT NULL, recent_n INTEGER NOT NULL,
  metrics_json TEXT NOT NULL, drift_json TEXT, alerts_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_monitor_sport_model
  ON learning_monitor_runs (sport, model_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recalibration_runs (
  id TEXT PRIMARY KEY, sport TEXT NOT NULL, model_id TEXT NOT NULL, method TEXT NOT NULL,
  train_n INTEGER NOT NULL, holdout_n INTEGER NOT NULL, total_n INTEGER NOT NULL,
  last_observed_at TEXT, params_json TEXT NOT NULL, metrics_json TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recalibration_sport_model
  ON recalibration_runs (sport, model_id, created_at DESC);

CREATE TABLE IF NOT EXISTS challenger_evaluations (
  id TEXT PRIMARY KEY, sport TEXT NOT NULL, champion_model_id TEXT NOT NULL,
  challenger_id TEXT NOT NULL, paired_n INTEGER NOT NULL, gate_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL, eligible_for_manual_promotion INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenger_sport_model
  ON challenger_evaluations (sport, champion_model_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bayesian_learning_state (
  sport TEXT NOT NULL, model_id TEXT NOT NULL, target TEXT NOT NULL,
  observed_n INTEGER NOT NULL, posterior_mean REAL, posterior_sd REAL,
  prior_mean REAL, prior_sd REAL, last_observed_at TEXT, metadata_json TEXT,
  updated_at TEXT NOT NULL, PRIMARY KEY (sport, model_id, target)
);

CREATE TABLE IF NOT EXISTS online_learning_shadow (
  sport TEXT NOT NULL, model_id TEXT NOT NULL, weight REAL NOT NULL, score REAL,
  observed_n INTEGER NOT NULL, production_enabled INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (sport, model_id)
);

CREATE TABLE IF NOT EXISTS model_promotion_decisions (
  id TEXT PRIMARY KEY, sport TEXT NOT NULL, champion_model_id TEXT NOT NULL,
  challenger_id TEXT NOT NULL, challenger_evaluation_id TEXT, decision TEXT NOT NULL,
  operator TEXT, evidence_json TEXT NOT NULL, applied INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS continuous_learning_meta (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);


-- Soccer canonical point-in-time history (0039)
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


-- Prospective CBB player-prop signal ledger (migration 0040).
CREATE TABLE IF NOT EXISTS cbb_player_prop_signals (
  id TEXT PRIMARY KEY,
  fbis_event_id TEXT NOT NULL,
  projection_id TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  market TEXT NOT NULL,
  side TEXT NOT NULL,
  signal_line REAL NOT NULL,
  signal_projection REAL NOT NULL,
  signal_sigma REAL NOT NULL,
  z_edge REAL NOT NULL,
  edge_band TEXT NOT NULL,
  signal_at TEXT NOT NULL,
  start_time TEXT,
  close_line REAL,
  close_at TEXT,
  line_clv REAL,
  actual REAL,
  result TEXT NOT NULL DEFAULT 'OPEN',
  settled_at TEXT,
  model_version TEXT NOT NULL,
  data_quality REAL,
  projected_minutes REAL,
  odds_tier TEXT,
  source TEXT NOT NULL DEFAULT 'PRIZEPICKS_APIFY',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_prop_signals_start
  ON cbb_player_prop_signals(start_time, result);
CREATE INDEX IF NOT EXISTS idx_cbb_prop_signals_market
  ON cbb_player_prop_signals(market, result, signal_at);
CREATE INDEX IF NOT EXISTS idx_cbb_prop_signals_player
  ON cbb_player_prop_signals(player_name, market, signal_at);


-- NFL point-in-time wager decision architecture (migration 0041).
CREATE TABLE IF NOT EXISTS nfl_wager_decisions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'nfl',
  evaluated_at TEXT NOT NULL,
  model_id TEXT,
  model_version TEXT,
  decision_version TEXT NOT NULL,
  market_type TEXT NOT NULL,
  selection TEXT NOT NULL,
  sportsbook TEXT,
  offered_line REAL,
  american_price REAL,
  break_even_probability REAL,
  model_probability REAL,
  probability_edge REAL,
  expected_value_per_unit_risk REAL,
  uncertainty_sigma REAL,
  raw_confidence_score INTEGER,
  confidence_score INTEGER,
  confidence_validated INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL,
  stake_units REAL,
  projection_json TEXT NOT NULL,
  decomposition_json TEXT,
  wager_intelligence_json TEXT,
  reasons_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nfl_wager_decisions_event_time
  ON nfl_wager_decisions(event_id, evaluated_at);
CREATE INDEX IF NOT EXISTS idx_nfl_wager_decisions_market
  ON nfl_wager_decisions(market_type, selection, evaluated_at);

CREATE TABLE IF NOT EXISTS nfl_wager_outcomes (
  decision_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  settled_at TEXT NOT NULL,
  result TEXT,
  units REAL,
  closing_line REAL,
  closing_price REAL,
  clv_line REAL,
  clv_price REAL,
  actual_margin REAL,
  actual_total REAL,
  evaluation_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(decision_id) REFERENCES nfl_wager_decisions(id)
);
CREATE INDEX IF NOT EXISTS idx_nfl_wager_outcomes_event
  ON nfl_wager_outcomes(event_id, settled_at);


-- WNBA prop validation ledger (migration 0040_wnba_prop_validation).
CREATE TABLE IF NOT EXISTS wnba_prop_validation (
  id TEXT PRIMARY KEY,
  source_line_id TEXT NOT NULL,
  run_id TEXT,
  event_id TEXT,
  game_start TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  market TEXT NOT NULL,
  line REAL NOT NULL,
  odds_tier TEXT,
  fbis_projection REAL NOT NULL,
  fbis_sigma REAL,
  projection_delta REAL,
  candidate_side TEXT,
  raw_star INTEGER,
  actual REAL NOT NULL,
  result TEXT NOT NULL,
  hit INTEGER,
  push INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT,
  collected_at TEXT,
  graded_at TEXT NOT NULL,
  model_version TEXT,
  UNIQUE(source_line_id)
);
CREATE INDEX IF NOT EXISTS idx_wnba_prop_validation_market_star
  ON wnba_prop_validation(market, raw_star, candidate_side, odds_tier);
CREATE INDEX IF NOT EXISTS idx_wnba_prop_validation_player
  ON wnba_prop_validation(player_name, game_start DESC);
CREATE VIEW IF NOT EXISTS wnba_prop_calibration AS
SELECT
  market, raw_star, candidate_side, COALESCE(odds_tier,'standard') AS odds_tier,
  COUNT(*) AS graded,
  SUM(CASE WHEN push=0 THEN 1 ELSE 0 END) AS decisions,
  SUM(CASE WHEN hit=1 THEN 1 ELSE 0 END) AS hits,
  CASE WHEN SUM(CASE WHEN push=0 THEN 1 ELSE 0 END) > 0
    THEN 1.0 * SUM(CASE WHEN hit=1 THEN 1 ELSE 0 END) /
      SUM(CASE WHEN push=0 THEN 1 ELSE 0 END)
    ELSE NULL END AS hit_rate,
  AVG(ABS(projection_delta)) AS avg_abs_projection_delta,
  AVG(CASE WHEN fbis_sigma IS NOT NULL AND fbis_sigma > 0
    THEN ABS(projection_delta / fbis_sigma) END) AS avg_abs_z
FROM wnba_prop_validation
GROUP BY market, raw_star, candidate_side, COALESCE(odds_tier,'standard');


-- NHL exact-price wager research architecture (migration 0042).
CREATE TABLE IF NOT EXISTS nhl_wager_decisions (
  id TEXT PRIMARY KEY,
  snapshot_at TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_start TEXT,
  game_type INTEGER,
  wager_scope TEXT NOT NULL, -- GAME | PROP
  player_id TEXT,
  player_name TEXT,
  team TEXT,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  line REAL,
  american_price REAL,
  model_probability REAL,
  calibrated_probability REAL,
  break_even_probability REAL,
  market_no_vig_probability REAL,
  probability_edge REAL,
  expected_roi REAL,
  reliability REAL,
  confidence INTEGER,
  confidence_version TEXT,
  confidence_status TEXT,
  decision TEXT NOT NULL,
  research_candidate INTEGER NOT NULL DEFAULT 0,
  suggested_units REAL NOT NULL DEFAULT 0,
  model_id TEXT,
  model_version TEXT,
  projection_json TEXT,
  disagreement_json TEXT,
  trajectory_json TEXT,
  source_snapshot_type TEXT,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nhl_wager_decisions_event
  ON nhl_wager_decisions(event_id, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_nhl_wager_decisions_market
  ON nhl_wager_decisions(wager_scope, market, selection, confidence, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_nhl_wager_decisions_research_bet
  ON nhl_wager_decisions(decision, snapshot_at);

CREATE TABLE IF NOT EXISTS nhl_wager_settlements (
  decision_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  settled_at TEXT NOT NULL,
  actual_home REAL,
  actual_away REAL,
  actual_player_value REAL,
  result TEXT NOT NULL, -- WIN | LOSS | PUSH | VOID
  risk_units REAL NOT NULL DEFAULT 1,
  profit_units REAL NOT NULL DEFAULT 0,
  close_line REAL,
  close_price REAL,
  close_no_vig_probability REAL,
  clv_probability_pp REAL,
  notes TEXT,
  FOREIGN KEY(decision_id) REFERENCES nhl_wager_decisions(id)
);

CREATE INDEX IF NOT EXISTS idx_nhl_wager_settlements_event
  ON nhl_wager_settlements(event_id, settled_at);

CREATE TABLE IF NOT EXISTS nhl_wager_confidence_runs (
  id TEXT PRIMARY KEY,
  run_at TEXT NOT NULL,
  source TEXT NOT NULL,
  game_validated INTEGER NOT NULL DEFAULT 0,
  prop_validated INTEGER NOT NULL DEFAULT 0,
  game_n INTEGER NOT NULL DEFAULT 0,
  prop_n INTEGER NOT NULL DEFAULT 0,
  game_json TEXT NOT NULL,
  prop_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_conf_runs_at ON nhl_wager_confidence_runs(run_at DESC);
CREATE INDEX IF NOT EXISTS idx_nhl_wager_decisions_game_type
  ON nhl_wager_decisions(game_type,wager_scope,snapshot_at);

CREATE VIEW IF NOT EXISTS nhl_wager_confidence_calibration AS
SELECT
  d.wager_scope,
  d.market,
  CASE
    WHEN d.confidence < 50 THEN '0-49'
    WHEN d.confidence < 60 THEN '50-59'
    WHEN d.confidence < 70 THEN '60-69'
    WHEN d.confidence < 80 THEN '70-79'
    WHEN d.confidence < 90 THEN '80-89'
    ELSE '90-100'
  END AS confidence_band,
  COUNT(*) AS graded,
  SUM(CASE WHEN s.result='WIN' THEN 1 ELSE 0 END) AS wins,
  SUM(CASE WHEN s.result='LOSS' THEN 1 ELSE 0 END) AS losses,
  SUM(CASE WHEN s.result='PUSH' THEN 1 ELSE 0 END) AS pushes,
  SUM(s.profit_units) AS units,
  CASE WHEN SUM(ABS(s.risk_units)) > 0
    THEN SUM(s.profit_units) / SUM(ABS(s.risk_units)) ELSE NULL END AS roi,
  AVG(d.calibrated_probability) AS mean_probability,
  AVG(CASE WHEN s.result='WIN' THEN 1.0 WHEN s.result='LOSS' THEN 0.0 END) AS win_rate,
  AVG(s.clv_probability_pp) AS avg_clv_probability_pp
FROM nhl_wager_decisions d
JOIN nhl_wager_settlements s ON s.decision_id=d.id
WHERE d.research_candidate=1
GROUP BY d.wager_scope,d.market,confidence_band;

-- NBA game + player projection research storage (migrations 0039-0042).
CREATE TABLE IF NOT EXISTS nba_game_features (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, feature_cutoff_timestamp TEXT NOT NULL,
  home_team TEXT NOT NULL, away_team TEXT NOT NULL, feature_json TEXT NOT NULL,
  source_manifest_json TEXT, content_hash TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_game_features_game
  ON nba_game_features(game_id, feature_cutoff_timestamp);

CREATE TABLE IF NOT EXISTS nba_game_projections (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, tipoff_timestamp TEXT,
  model_id TEXT NOT NULL, model_version TEXT, feature_cutoff_timestamp TEXT NOT NULL,
  projected_home REAL, projected_away REAL, projected_margin REAL, projected_total REAL,
  expected_possessions REAL, p_home_win REAL, sigma_margin REAL, sigma_total REAL,
  maturity TEXT NOT NULL DEFAULT 'RESEARCH', can_qualify INTEGER NOT NULL DEFAULT 1,
  can_authorize INTEGER NOT NULL DEFAULT 0, provenance_json TEXT, created_at TEXT NOT NULL,
  actual_home REAL, actual_away REAL, graded_at TEXT,
  market_at_projection_json TEXT, close_market_json TEXT, market_joined_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nba_game_proj_game
  ON nba_game_projections(game_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nba_game_proj_ungraded
  ON nba_game_projections(game_id, graded_at, feature_cutoff_timestamp);

CREATE TABLE IF NOT EXISTS nba_player_game_features (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, player_id TEXT, player_name TEXT NOT NULL,
  team TEXT NOT NULL, feature_cutoff_timestamp TEXT NOT NULL, feature_json TEXT NOT NULL,
  provenance_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_player_features_game
  ON nba_player_game_features(game_id, player_name);

CREATE TABLE IF NOT EXISTS nba_player_prop_projections (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, player_id TEXT, player_name TEXT NOT NULL,
  team TEXT NOT NULL, market_type TEXT NOT NULL, projection REAL, sigma REAL, projected_minutes REAL,
  availability_status TEXT, model_id TEXT NOT NULL, model_version TEXT,
  feature_cutoff_timestamp TEXT NOT NULL, maturity TEXT NOT NULL DEFAULT 'RESEARCH',
  can_qualify INTEGER NOT NULL DEFAULT 1, can_authorize INTEGER NOT NULL DEFAULT 0,
  provenance_json TEXT, created_at TEXT NOT NULL,
  actual_value REAL, graded_at TEXT, availability_verified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_nba_prop_proj_game
  ON nba_player_prop_projections(game_id, player_name, market_type);
CREATE INDEX IF NOT EXISTS idx_nba_prop_proj_ungraded
  ON nba_player_prop_projections(game_id, graded_at, player_id, market_type);

CREATE TABLE IF NOT EXISTS nba_prop_comparisons (
  id TEXT PRIMARY KEY, projection_id TEXT, game_id TEXT NOT NULL, player_id TEXT, player_name TEXT NOT NULL,
  market_type TEXT NOT NULL, source TEXT NOT NULL, market_line REAL NOT NULL,
  observed_at TEXT NOT NULL, fbis_projection REAL, sigma REAL, difference REAL,
  probability_over REAL, probability_under REAL, candidate_side TEXT,
  decision_eligible INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_prop_cmp_game
  ON nba_prop_comparisons(game_id, market_type);

CREATE TABLE IF NOT EXISTS nba_game_market_evaluations (
  id TEXT PRIMARY KEY, projection_id TEXT NOT NULL, game_id TEXT NOT NULL,
  model_id TEXT NOT NULL, model_version TEXT, checkpoint TEXT,
  market_type TEXT NOT NULL, side TEXT NOT NULL,
  entry_line REAL, entry_price REAL, entry_no_vig REAL, entry_captured_at TEXT,
  close_line REAL, close_price REAL, close_no_vig REAL, close_captured_at TEXT,
  model_probability REAL, edge_probability REAL, expected_value REAL,
  line_clv REAL, probability_clv REAL, actual_home REAL, actual_away REAL,
  result TEXT, profit_units REAL, qualified INTEGER NOT NULL DEFAULT 0,
  qualification_reason TEXT, can_authorize INTEGER NOT NULL DEFAULT 0,
  evaluated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nba_prop_market_evaluations (
  id TEXT PRIMARY KEY, projection_id TEXT NOT NULL, game_id TEXT,
  player_id TEXT, player_name TEXT NOT NULL, market_type TEXT NOT NULL,
  candidate_side TEXT, projection REAL, sigma REAL,
  entry_line REAL, entry_observed_at TEXT, close_line REAL, close_observed_at TEXT,
  line_edge REAL, standardized_edge REAL, model_probability REAL,
  actual_value REAL, result TEXT, line_clv REAL,
  qualified INTEGER NOT NULL DEFAULT 0, qualification_reason TEXT,
  can_authorize INTEGER NOT NULL DEFAULT 0, evaluated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nba_qualification_state (
  model_id TEXT PRIMARY KEY,
  can_qualify INTEGER NOT NULL DEFAULT 1,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  prospective_n INTEGER NOT NULL DEFAULT 0,
  graded_n INTEGER NOT NULL DEFAULT 0,
  qualified_n INTEGER NOT NULL DEFAULT 0,
  positive_clv_rate REAL, roi_units REAL, roi_pct REAL,
  status TEXT NOT NULL DEFAULT 'QUALIFICATION_ENABLED',
  gates_json TEXT, evaluated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nba_wager_decisions (
  id TEXT PRIMARY KEY, projection_id TEXT NOT NULL, game_id TEXT NOT NULL,
  model_id TEXT NOT NULL, model_version TEXT, decision_timestamp TEXT NOT NULL,
  market_type TEXT NOT NULL, side TEXT NOT NULL,
  offered_line REAL, offered_price REAL,
  model_probability REAL, break_even_probability REAL, probability_edge REAL, expected_value REAL,
  projection_uncertainty REAL, matchup_reliability REAL, data_quality REAL,
  data_freshness_minutes REAL, historical_factor_reliability REAL, market_confirmation TEXT,
  fbis_confidence REAL, confidence_status TEXT,
  confidence_decision_eligible INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL, qualification_eligible INTEGER NOT NULL DEFAULT 0,
  stake_units REAL, stake_status TEXT NOT NULL DEFAULT 'UNVALIDATED',
  decomposition_json TEXT, market_trajectory_json TEXT, action_intelligence_json TEXT,
  historical_context_json TEXT, safeguards_json TEXT, reasons_json TEXT,
  actual_home REAL, actual_away REAL, close_line REAL, close_price REAL,
  clv_line REAL, clv_probability REAL, result TEXT, profit_units REAL,
  graded_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_wager_decision_game
  ON nba_wager_decisions(game_id, decision_timestamp);
CREATE INDEX IF NOT EXISTS idx_nba_wager_decision_state
  ON nba_wager_decisions(decision, qualification_eligible, graded_at);

CREATE TABLE IF NOT EXISTS nba_confidence_calibration (
  id TEXT PRIMARY KEY, model_id TEXT NOT NULL, model_version TEXT,
  market_type TEXT, sample_n INTEGER NOT NULL, bins_json TEXT NOT NULL,
  brier_score REAL, log_loss REAL, roi_pct REAL, positive_clv_rate REAL,
  monotonicity_pass INTEGER NOT NULL DEFAULT 0, monotonicity_details_json TEXT,
  training_cutoff TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nba_decision_validation_runs (
  id TEXT PRIMARY KEY, model_id TEXT NOT NULL, model_version TEXT,
  window_start TEXT, window_end TEXT,
  prospective_n INTEGER NOT NULL DEFAULT 0, graded_n INTEGER NOT NULL DEFAULT 0,
  bet_n INTEGER NOT NULL DEFAULT 0, units REAL, roi_pct REAL,
  max_drawdown_units REAL, positive_clv_rate REAL,
  calibration_json TEXT, confidence_monotonicity_json TEXT,
  season_stability_json TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL
);


-- WNBA game-level wager decision architecture (migration 0043)
-- Append-only point-in-time WNBA game wagering decisions and outcomes.
CREATE TABLE IF NOT EXISTS wnba_wager_decisions (
  id TEXT PRIMARY KEY,
  natural_key TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL,
  event_start TEXT,
  captured_at TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT,
  decision_version TEXT NOT NULL,
  model_as_of TEXT,
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
  raw_confidence INTEGER,
  confidence INTEGER,
  confidence_calibration_state TEXT,
  confidence_calibration_n INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL,
  stake_units REAL,
  stake_state TEXT,
  projection_json TEXT NOT NULL,
  factors_json TEXT,
  market_intelligence_json TEXT,
  evidence_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wnba_wager_decisions_event_time
  ON wnba_wager_decisions(event_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_wnba_wager_decisions_market_conf
  ON wnba_wager_decisions(market, confidence, captured_at);
CREATE INDEX IF NOT EXISTS idx_wnba_wager_decisions_decision
  ON wnba_wager_decisions(decision, captured_at);

CREATE TABLE IF NOT EXISTS wnba_wager_results (
  decision_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  actual_home REAL,
  actual_away REAL,
  actual_margin REAL,
  actual_total REAL,
  result TEXT NOT NULL,
  win INTEGER,
  push INTEGER NOT NULL DEFAULT 0,
  close_line REAL,
  close_price REAL,
  clv_line REAL,
  clv_price REAL,
  settled_at TEXT NOT NULL,
  provenance_json TEXT,
  FOREIGN KEY(decision_id) REFERENCES wnba_wager_decisions(id)
);

CREATE INDEX IF NOT EXISTS idx_wnba_wager_results_event
  ON wnba_wager_results(event_id, settled_at);

CREATE VIEW IF NOT EXISTS wnba_wager_confidence_calibration AS
SELECT
  d.market,
  d.side,
  CAST(d.confidence / 10 AS INTEGER) * 10 AS confidence_band,
  COUNT(*) AS graded,
  SUM(CASE WHEN r.push=0 THEN 1 ELSE 0 END) AS decisions,
  SUM(CASE WHEN r.win=1 THEN 1 ELSE 0 END) AS wins,
  CASE WHEN SUM(CASE WHEN r.push=0 THEN 1 ELSE 0 END)>0
    THEN 1.0*SUM(CASE WHEN r.win=1 THEN 1 ELSE 0 END)/
         SUM(CASE WHEN r.push=0 THEN 1 ELSE 0 END)
    ELSE NULL END AS hit_rate,
  AVG(d.expected_value) AS avg_expected_value,
  AVG(CASE WHEN r.push=0 THEN
    CASE WHEN r.win=1 THEN
      CASE WHEN d.american_price>0 THEN d.american_price/100.0 ELSE 100.0/ABS(d.american_price) END
    ELSE -1 END
  END) AS units_per_decision,
  AVG(r.clv_line) AS avg_clv_line,
  AVG(r.clv_price) AS avg_clv_price
FROM wnba_wager_decisions d
JOIN wnba_wager_results r ON r.decision_id=d.id
WHERE d.decision='BET'
GROUP BY d.market,d.side,CAST(d.confidence / 10 AS INTEGER) * 10;


-- Generic player-prop projection -> actual -> calibration loop (0047).
CREATE TABLE IF NOT EXISTS player_prop_cards (
  card_id TEXT PRIMARY KEY, date TEXT NOT NULL, sport TEXT NOT NULL, book TEXT NOT NULL,
  entry_type TEXT NOT NULL, risk REAL, to_win REAL, status TEXT NOT NULL DEFAULT 'OPEN',
  result TEXT, profit REAL, captured_at TEXT NOT NULL, settled_at TEXT, notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS player_prop_legs (
  leg_id TEXT PRIMARY KEY, card_id TEXT NOT NULL, sport TEXT NOT NULL, event_id TEXT,
  provider_game_id TEXT, player_name TEXT NOT NULL, team TEXT, matchup TEXT, market TEXT NOT NULL,
  side TEXT NOT NULL, entry_line REAL NOT NULL, fbis_projection REAL, fbis_sigma REAL,
  projection_edge REAL, model_version TEXT, model_source TEXT, source_line_id TEXT,
  projection_observed_at TEXT, projection_locked_at TEXT, role_confidence REAL, snap_share REAL,
  prop_gate TEXT, calibration_eligibility TEXT NOT NULL DEFAULT 'PENDING', live_actual REAL,
  actual REAL, projection_error REAL, absolute_error REAL, squared_error REAL,
  result TEXT NOT NULL DEFAULT 'OPEN', hit INTEGER, push INTEGER NOT NULL DEFAULT 0,
  closing_line REAL, line_clv REAL, stat_source TEXT, graded_at TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(card_id) REFERENCES player_prop_cards(card_id)
);
CREATE INDEX IF NOT EXISTS idx_player_prop_legs_open ON player_prop_legs(sport, result, event_id);
CREATE INDEX IF NOT EXISTS idx_player_prop_legs_model ON player_prop_legs(sport, market, model_version, graded_at);
CREATE INDEX IF NOT EXISTS idx_player_prop_legs_card ON player_prop_legs(card_id);
CREATE VIEW IF NOT EXISTS player_prop_calibration AS
SELECT sport,market,side,model_version,COUNT(*) graded,
 SUM(CASE WHEN push=0 THEN 1 ELSE 0 END) decisions,SUM(CASE WHEN hit=1 THEN 1 ELSE 0 END) wins,
 CASE WHEN SUM(CASE WHEN push=0 THEN 1 ELSE 0 END)>0 THEN 1.0*SUM(CASE WHEN hit=1 THEN 1 ELSE 0 END)/SUM(CASE WHEN push=0 THEN 1 ELSE 0 END) ELSE NULL END hit_rate,
 AVG(projection_error) projection_bias,AVG(absolute_error) mae,SQRT(AVG(squared_error)) rmse,
 AVG(projection_edge) avg_projection_edge,AVG(line_clv) avg_line_clv
FROM player_prop_legs WHERE actual IS NOT NULL AND calibration_eligibility LIKE 'ELIGIBLE%'
GROUP BY sport,market,side,model_version;


-- NBA player impact / role context (migration 0048).
CREATE TABLE IF NOT EXISTS nba_player_impact_snapshots (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  player_name TEXT,
  team_id TEXT,
  position TEXT,
  as_of TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  offense_impact REAL,
  defense_impact REAL,
  net_impact REAL,
  rapm_net REAL,
  raw_on_off REAL,
  bpm_style REAL,
  vorp_style REAL,
  ws48_style REAL,
  dynamic_skill_json TEXT,
  provenance_json TEXT,
  production_eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_impact_player_time
  ON nba_player_impact_snapshots(player_id,as_of DESC);
CREATE INDEX IF NOT EXISTS idx_nba_impact_team_time
  ON nba_player_impact_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS nba_player_role_contexts (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  player_id TEXT NOT NULL,
  player_name TEXT,
  team_id TEXT,
  feature_cutoff_timestamp TEXT NOT NULL,
  minutes_delta REAL,
  usage_multiplier REAL,
  points_multiplier REAL,
  rebounds_multiplier REAL,
  assists_multiplier REAL,
  threes_multiplier REAL,
  lineup_multiplier REAL,
  unavailable_count INTEGER NOT NULL DEFAULT 0,
  availability_verified INTEGER NOT NULL DEFAULT 0,
  context_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_role_context_game
  ON nba_player_role_contexts(game_id,player_id,feature_cutoff_timestamp DESC);

CREATE TABLE IF NOT EXISTS nba_player_impact_benchmarks (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  player_name TEXT,
  as_of TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  source TEXT NOT NULL,
  license_status TEXT,
  research_only INTEGER NOT NULL DEFAULT 1,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_impact_benchmark
  ON nba_player_impact_benchmarks(metric,as_of,player_id);



CREATE TABLE IF NOT EXISTS nba_player_prop_impact_shadow (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  market_type TEXT NOT NULL,
  baseline_projection REAL,
  impact_projection REAL,
  sigma REAL,
  projected_minutes REAL,
  feature_cutoff_timestamp TEXT NOT NULL,
  availability_status TEXT,
  availability_verified INTEGER NOT NULL DEFAULT 0,
  context_json TEXT,
  entry_line REAL,
  entry_observed_at TEXT,
  close_line REAL,
  close_observed_at TEXT,
  actual_value REAL,
  baseline_abs_error REAL,
  impact_abs_error REAL,
  baseline_side TEXT,
  impact_side TEXT,
  impact_probability REAL,
  line_clv REAL,
  graded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_prop_impact_shadow_game
  ON nba_player_prop_impact_shadow(game_id,player_id,market_type);
CREATE INDEX IF NOT EXISTS idx_nba_prop_impact_shadow_grade
  ON nba_player_prop_impact_shadow(graded_at,feature_cutoff_timestamp);

CREATE TABLE IF NOT EXISTS nba_player_impact_validation (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  training_window TEXT,
  holdout_window TEXT,
  market_type TEXT NOT NULL,
  n INTEGER NOT NULL,
  baseline_mae REAL,
  impact_mae REAL,
  mae_delta REAL,
  baseline_bias REAL,
  impact_bias REAL,
  passed INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  created_at TEXT NOT NULL
);


-- WNBA player impact / lineup / role challengers (migration 0049).
-- 0049_wnba_player_impact.sql
CREATE TABLE IF NOT EXISTS wnba_player_impact_snapshots (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  player_name TEXT,
  team_id TEXT,
  position TEXT,
  as_of TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  offense_impact REAL,
  defense_impact REAL,
  net_impact REAL,
  rapm_net REAL,
  bpm_style REAL,
  vorp_style REAL,
  ws48_style REAL,
  dynamic_skill_json TEXT,
  provenance_json TEXT,
  production_eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_impact_player_time ON wnba_player_impact_snapshots(player_id,as_of DESC);
CREATE INDEX IF NOT EXISTS idx_wnba_impact_team_time ON wnba_player_impact_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS wnba_player_role_contexts (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  player_name TEXT,
  team_id TEXT,
  feature_cutoff_timestamp TEXT NOT NULL,
  minutes_delta REAL,
  usage_multiplier REAL,
  points_multiplier REAL,
  rebounds_multiplier REAL,
  assists_multiplier REAL,
  threes_multiplier REAL,
  lineup_multiplier REAL,
  unavailable_count INTEGER NOT NULL DEFAULT 0,
  availability_verified INTEGER NOT NULL DEFAULT 0,
  context_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_role_player_time ON wnba_player_role_contexts(player_id,feature_cutoff_timestamp DESC);

CREATE TABLE IF NOT EXISTS wnba_player_prop_impact_shadow (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_start TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  market_type TEXT NOT NULL,
  feature_cutoff_timestamp TEXT NOT NULL,
  baseline_projection REAL,
  impact_projection REAL,
  sigma REAL,
  projected_minutes REAL,
  player_impact_net REAL,
  availability_verified INTEGER NOT NULL DEFAULT 0,
  role_context_json TEXT,
  lineup_context_json TEXT,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  entry_line REAL,
  entry_observed_at TEXT,
  close_line REAL,
  close_observed_at TEXT,
  actual_value REAL,
  baseline_abs_error REAL,
  impact_abs_error REAL,
  baseline_side TEXT,
  impact_side TEXT,
  impact_probability REAL,
  line_clv REAL,
  graded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_impact_shadow_event ON wnba_player_prop_impact_shadow(event_id,player_name,market_type);
CREATE INDEX IF NOT EXISTS idx_wnba_impact_shadow_grade ON wnba_player_prop_impact_shadow(graded_at,feature_cutoff_timestamp);

CREATE TABLE IF NOT EXISTS wnba_game_impact_shadow (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_start TEXT,
  feature_cutoff_timestamp TEXT NOT NULL,
  baseline_home REAL,
  baseline_away REAL,
  baseline_margin REAL,
  baseline_total REAL,
  impact_home REAL,
  impact_away REAL,
  impact_margin REAL,
  impact_total REAL,
  home_adjustment REAL,
  away_adjustment REAL,
  availability_verified INTEGER NOT NULL DEFAULT 0,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  context_json TEXT,
  actual_home REAL,
  actual_away REAL,
  baseline_margin_abs_error REAL,
  impact_margin_abs_error REAL,
  baseline_total_abs_error REAL,
  impact_total_abs_error REAL,
  graded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wnba_game_impact_event ON wnba_game_impact_shadow(event_id,feature_cutoff_timestamp DESC);

CREATE TABLE IF NOT EXISTS wnba_player_impact_validation (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  validation_type TEXT NOT NULL,
  market_type TEXT NOT NULL,
  n INTEGER NOT NULL,
  baseline_mae REAL,
  impact_mae REAL,
  mae_delta REAL,
  baseline_side_accuracy REAL,
  impact_side_accuracy REAL,
  side_accuracy_delta REAL,
  positive_clv_rate REAL,
  passed INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  created_at TEXT NOT NULL
);


-- Tennis v2 market/context research architecture (migration 0050).
CREATE TABLE IF NOT EXISTS tennis_market_snapshots (
  id TEXT PRIMARY KEY,
  canonical_event_id TEXT NOT NULL,
  tour TEXT NOT NULL,
  player1 TEXT NOT NULL,
  player2 TEXT NOT NULL,
  market_type TEXT NOT NULL DEFAULT 'moneyline',
  provider TEXT NOT NULL,
  sportsbook TEXT,
  player1_price REAL,
  player2_price REAL,
  player1_no_vig_prob REAL,
  player2_no_vig_prob REAL,
  hold REAL,
  observed_at TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  event_start_time TEXT,
  snapshot_type TEXT,
  traded_volume REAL,
  public_ticket_pct REAL,
  public_money_pct REAL,
  money_minus_ticket_pct REAL,
  line_velocity REAL,
  raw_payload_hash TEXT,
  decision_eligible INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tennis_market_event_time
  ON tennis_market_snapshots(canonical_event_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_tennis_market_provider
  ON tennis_market_snapshots(provider, tour, observed_at);

CREATE TABLE IF NOT EXISTS tennis_context_snapshots (
  id TEXT PRIMARY KEY,
  canonical_event_id TEXT NOT NULL,
  canonical_player_id TEXT,
  player_name TEXT NOT NULL,
  tour TEXT NOT NULL,
  tournament TEXT,
  surface TEXT,
  indoor INTEGER,
  altitude_m REAL,
  court_speed_index REAL,
  hours_since_last_match REAL,
  minutes_last_3_days REAL,
  minutes_last_7_days REAL,
  games_last_3_days REAL,
  games_last_7_days REAL,
  sets_last_3_days REAL,
  sets_last_7_days REAL,
  travel_km_7_days REAL,
  time_zones_crossed_7_days REAL,
  injury_status TEXT,
  days_since_injury_return REAL,
  days_since_retirement_or_mto REAL,
  recent_serve_speed_delta_kph REAL,
  serve_style_score REAL,
  return_style_score REAL,
  source TEXT NOT NULL,
  source_as_of TEXT,
  collected_at TEXT NOT NULL,
  feature_cutoff_timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tennis_context_event_player
  ON tennis_context_snapshots(canonical_event_id, player_name, feature_cutoff_timestamp);

CREATE TABLE IF NOT EXISTS tennis_v2_research_decisions (
  id TEXT PRIMARY KEY,
  canonical_event_id TEXT NOT NULL,
  tour TEXT NOT NULL,
  player1 TEXT NOT NULL,
  player2 TEXT NOT NULL,
  pure_model_id TEXT NOT NULL,
  market_model_id TEXT,
  pure_p1 REAL,
  market_prior_p1 REAL,
  market_v2_p1 REAL,
  market_residual REAL,
  model_edge REAL,
  context_json TEXT,
  action_json TEXT,
  market_json TEXT,
  decision_timestamp TEXT NOT NULL,
  event_start_time TEXT,
  snapshot_type TEXT NOT NULL,
  result_winner TEXT,
  closing_p1_no_vig REAL,
  clv REAL,
  profit_units REAL,
  graded_at TEXT,
  decision_eligible INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tennis_v2_decisions_event
  ON tennis_v2_research_decisions(canonical_event_id, decision_timestamp);
CREATE INDEX IF NOT EXISTS idx_tennis_v2_decisions_grade
  ON tennis_v2_research_decisions(graded_at, tour);


-- Tennis v2 current research profiles and tournament court-speed state (0051).
CREATE TABLE IF NOT EXISTS tennis_player_profiles_current (
  tour TEXT NOT NULL,
  player_key TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  surface TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  last_match_date TEXT,
  last_surface TEXT,
  last_tournament TEXT,
  games_last_3_days REAL,
  games_last_7_days REAL,
  sets_last_3_days REAL,
  sets_last_7_days REAL,
  days_since_retirement_or_mto REAL,
  source TEXT NOT NULL,
  source_license TEXT,
  source_as_of TEXT NOT NULL,
  production_dependency INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tour, player_key, surface)
);
CREATE INDEX IF NOT EXISTS idx_tennis_profiles_name
  ON tennis_player_profiles_current(tour, player_name, surface);
CREATE INDEX IF NOT EXISTS idx_tennis_profiles_updated
  ON tennis_player_profiles_current(updated_at, tour);

CREATE TABLE IF NOT EXISTS tennis_tournament_speed_current (
  tour TEXT NOT NULL,
  tournament_key TEXT NOT NULL,
  tournament_name TEXT NOT NULL,
  season INTEGER NOT NULL,
  surface TEXT NOT NULL,
  court_speed_index REAL,
  sample_sides INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  source_as_of TEXT NOT NULL,
  production_dependency INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tour, tournament_key, season)
);
CREATE INDEX IF NOT EXISTS idx_tennis_speed_surface
  ON tennis_tournament_speed_current(tour, surface, season, updated_at);


-- NBA deep game-model challenger (migration 0052).
-- NBA deep game-model challenger: Four Factors, shot profile, lineup and real travel/rest.
CREATE TABLE IF NOT EXISTS nba_deep_game_shadow (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  tipoff_timestamp TEXT,
  feature_cutoff_timestamp TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  incumbent_model_id TEXT NOT NULL,
  projected_home REAL,
  projected_away REAL,
  projected_margin REAL,
  projected_total REAL,
  expected_possessions REAL,
  p_home_win REAL,
  sigma_margin REAL,
  sigma_total REAL,
  incumbent_margin REAL,
  incumbent_total REAL,
  margin_adjustment REAL,
  total_adjustment REAL,
  availability_verified INTEGER NOT NULL DEFAULT 0,
  feature_json TEXT,
  decomposition_json TEXT,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  actual_home REAL,
  actual_away REAL,
  margin_abs_error REAL,
  total_abs_error REAL,
  incumbent_margin_abs_error REAL,
  incumbent_total_abs_error REAL,
  graded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_deep_shadow_game
  ON nba_deep_game_shadow(game_id,feature_cutoff_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_nba_deep_shadow_grade
  ON nba_deep_game_shadow(graded_at,feature_cutoff_timestamp);

CREATE TABLE IF NOT EXISTS nba_deep_validation_runs (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  validation_type TEXT NOT NULL,
  training_start TEXT,
  training_cutoff TEXT,
  holdout_start TEXT,
  n INTEGER NOT NULL,
  incumbent_margin_mae REAL,
  challenger_margin_mae REAL,
  margin_improvement REAL,
  incumbent_total_mae REAL,
  challenger_total_mae REAL,
  total_improvement REAL,
  incumbent_winner_accuracy REAL,
  challenger_winner_accuracy REAL,
  evidence_pass INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_deep_validation_created
  ON nba_deep_validation_runs(created_at DESC);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0052_nba_deep_game_model',datetime('now'));


-- NBA official availability coverage (migration 0053).
-- Official NBA injury-report submission evidence.
CREATE TABLE IF NOT EXISTS nba_official_availability_reports (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'NBA_OFFICIAL_INJURY_REPORT',
  report_url TEXT NOT NULL,
  report_timestamp TEXT NOT NULL,
  game_date TEXT,
  game_time_et TEXT,
  matchup TEXT,
  team_key TEXT NOT NULL,
  team_name TEXT,
  opponent_key TEXT,
  submission_status TEXT NOT NULL,
  player_rows INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_official_avail_team_time
  ON nba_official_availability_reports(team_key,report_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_nba_official_avail_matchup_time
  ON nba_official_availability_reports(matchup,report_timestamp DESC);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0053_nba_official_availability',datetime('now'));
