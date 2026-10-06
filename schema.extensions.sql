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


-- NBA persistent team/player profiles (migration 0054).
-- Persistent NBA team/player state profiles.
CREATE TABLE IF NOT EXISTS nba_team_profiles (
  team_id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  team_name TEXT NOT NULL,
  as_of TEXT NOT NULL,
  season INTEGER,
  head_coach_id TEXT,
  head_coach_name TEXT,
  coach_experience_years REAL,
  roster_json TEXT NOT NULL,
  rotation_json TEXT NOT NULL,
  availability_json TEXT NOT NULL,
  style_json TEXT,
  schedule_json TEXT NOT NULL,
  schedule_weak_spots_json TEXT NOT NULL,
  travel_json TEXT,
  profile_json TEXT NOT NULL,
  state_confidence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nba_team_profiles_key ON nba_team_profiles(team_key);

CREATE TABLE IF NOT EXISTS nba_team_profile_snapshots (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  as_of TEXT NOT NULL,
  season INTEGER,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_team_profile_snapshots_time
  ON nba_team_profile_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS nba_player_state_profiles (
  player_id TEXT PRIMARY KEY,
  player_name TEXT NOT NULL,
  team_id TEXT,
  team_key TEXT,
  as_of TEXT NOT NULL,
  status TEXT NOT NULL,
  state_source TEXT NOT NULL,
  state_source_timestamp TEXT,
  injury_detail TEXT,
  injury_type TEXT,
  injury_severity TEXT,
  carried_forward INTEGER NOT NULL DEFAULT 0,
  expected_minutes REAL,
  rotation_role TEXT,
  starter_probability REAL,
  player_impact_net REAL,
  replacement_json TEXT,
  state_confidence REAL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_player_state_team
  ON nba_player_state_profiles(team_key,status);
CREATE INDEX IF NOT EXISTS idx_nba_player_state_time
  ON nba_player_state_profiles(state_source_timestamp DESC);

CREATE TABLE IF NOT EXISTS nba_player_state_events (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team_key TEXT,
  event_type TEXT NOT NULL,
  status TEXT,
  injury_detail TEXT,
  source TEXT NOT NULL,
  source_timestamp TEXT NOT NULL,
  evidence_rank INTEGER NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_player_state_events_player
  ON nba_player_state_events(player_id,source_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_nba_player_state_events_name
  ON nba_player_state_events(player_name,source_timestamp DESC);

CREATE TABLE IF NOT EXISTS nba_lineup_observations (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  team_key TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  lineup_status TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  tipoff_timestamp TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_lineup_obs_team_time
  ON nba_lineup_observations(team_key,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_nba_lineup_obs_player_time
  ON nba_lineup_observations(player_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS nba_team_schedule_items (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  game_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  opponent_key TEXT,
  venue_team_key TEXT,
  home_away TEXT,
  neutral_site INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  rest_days REAL,
  back_to_back INTEGER NOT NULL DEFAULT 0,
  three_in_four INTEGER NOT NULL DEFAULT 0,
  four_in_six INTEGER NOT NULL DEFAULT 0,
  travel_miles REAL,
  time_zones_crossed REAL,
  altitude_feet REAL,
  road_trip_game_number INTEGER NOT NULL DEFAULT 0,
  consecutive_road_games INTEGER NOT NULL DEFAULT 0,
  schedule_stress_score REAL,
  stress_reasons_json TEXT,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_team_schedule_team_time
  ON nba_team_schedule_items(team_id,start_time);
CREATE INDEX IF NOT EXISTS idx_nba_team_schedule_game
  ON nba_team_schedule_items(game_id);

CREATE TABLE IF NOT EXISTS nba_team_coach_history (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  coach_id TEXT,
  coach_name TEXT NOT NULL,
  role TEXT,
  experience_years REAL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_team_coach_history
  ON nba_team_coach_history(team_id,observed_at DESC);


-- NHL persistent profiles (migration 0056)
-- Persistent NHL team/player/deployment operating profiles.
-- Expensive source refresh is asynchronous. Projection requests read compact D1 state only.

CREATE TABLE IF NOT EXISTS nhl_team_profiles (
  team_key TEXT PRIMARY KEY,
  team_abbr TEXT NOT NULL,
  official_abbr TEXT NOT NULL,
  team_name TEXT,
  season_id INTEGER NOT NULL,
  profile_version TEXT NOT NULL,
  roster_count INTEGER NOT NULL DEFAULT 0,
  active_count INTEGER NOT NULL DEFAULT 0,
  scratch_count INTEGER NOT NULL DEFAULT 0,
  unavailable_count INTEGER NOT NULL DEFAULT 0,
  next_game_id TEXT,
  next_game_start TEXT,
  next_opponent_key TEXT,
  next_site TEXT,
  rest_days REAL,
  back_to_back INTEGER NOT NULL DEFAULT 0,
  three_in_four INTEGER NOT NULL DEFAULT 0,
  four_in_six INTEGER NOT NULL DEFAULT 0,
  road_trip_game_number INTEGER NOT NULL DEFAULT 0,
  travel_miles REAL,
  time_zones_crossed INTEGER,
  schedule_stress_score REAL,
  schedule_flags_json TEXT,
  deployment_json TEXT,
  goalie_json TEXT,
  coach_json TEXT,
  style_json TEXT,
  state_confidence REAL,
  source_updated_at TEXT,
  updated_at TEXT NOT NULL,
  profile_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nhl_player_profiles (
  player_key TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  player_name TEXT NOT NULL,
  position TEXT,
  sweater_number TEXT,
  roster_status TEXT,
  availability_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  game_state TEXT NOT NULL DEFAULT 'EXPECTED_ACTIVE',
  injury_detail TEXT,
  ev_line INTEGER,
  d_pair INTEGER,
  pp_unit INTEGER,
  pk_unit INTEGER,
  last_game_id TEXT,
  last_game_at TEXT,
  last_toi_seconds REAL,
  rolling_toi_seconds REAL,
  rolling_pp_toi_seconds REAL,
  shots_per_game REAL,
  points_per_game REAL,
  role_confidence REAL,
  state_confidence REAL,
  source TEXT,
  source_updated_at TEXT,
  carried_state INTEGER NOT NULL DEFAULT 0,
  replacement_json TEXT,
  linemate_json TEXT,
  raw_json TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_player_profiles_team_role
  ON nhl_player_profiles(team_key,position,ev_line,d_pair,pp_unit);
CREATE INDEX IF NOT EXISTS idx_nhl_player_profiles_state
  ON nhl_player_profiles(availability_state,source_updated_at DESC);

CREATE TABLE IF NOT EXISTS nhl_goalie_profiles (
  player_id TEXT PRIMARY KEY,
  player_name TEXT NOT NULL,
  team_key TEXT NOT NULL,
  hierarchy_rank INTEGER,
  goalie_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  expected_start_probability REAL,
  games INTEGER,
  starts INTEGER,
  save_pct REAL,
  gaa REAL,
  last_game_id TEXT,
  last_game_at TEXT,
  rolling_shots_faced REAL,
  rolling_saves REAL,
  rest_days REAL,
  state_confidence REAL,
  source_updated_at TEXT,
  raw_json TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_goalie_profiles_team
  ON nhl_goalie_profiles(team_key,hierarchy_rank);

CREATE TABLE IF NOT EXISTS nhl_linemate_profiles (
  id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  player_id TEXT NOT NULL,
  teammate_id TEXT NOT NULL,
  games_sample INTEGER NOT NULL DEFAULT 0,
  shared_seconds REAL NOT NULL DEFAULT 0,
  shared_seconds_per_game REAL,
  overlap_share REAL,
  strength_state TEXT NOT NULL DEFAULT 'ALL_SITUATIONS',
  last_game_id TEXT,
  last_observed_at TEXT,
  confidence REAL,
  raw_json TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(team_key,player_id,teammate_id,strength_state)
);
CREATE INDEX IF NOT EXISTS idx_nhl_linemate_profiles_player
  ON nhl_linemate_profiles(team_key,player_id,shared_seconds DESC);

CREATE TABLE IF NOT EXISTS nhl_deployment_observations (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  game_start TEXT,
  team_key TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT,
  position TEXT,
  ev_line INTEGER,
  d_pair INTEGER,
  pp_unit INTEGER,
  pk_unit INTEGER,
  toi_seconds REAL,
  scratch INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_deployment_obs_team_time
  ON nhl_deployment_observations(team_key,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_nhl_deployment_obs_player_time
  ON nhl_deployment_observations(player_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS nhl_team_schedule_profile (
  id TEXT PRIMARY KEY,
  season_id INTEGER NOT NULL,
  team_key TEXT NOT NULL,
  game_id TEXT NOT NULL,
  game_type INTEGER,
  start_time TEXT,
  game_state TEXT,
  home_team_key TEXT,
  away_team_key TEXT,
  opponent_key TEXT,
  site TEXT,
  venue_name TEXT,
  neutral_site INTEGER NOT NULL DEFAULT 0,
  days_rest REAL,
  back_to_back INTEGER NOT NULL DEFAULT 0,
  three_in_four INTEGER NOT NULL DEFAULT 0,
  four_in_six INTEGER NOT NULL DEFAULT 0,
  road_trip_game_number INTEGER NOT NULL DEFAULT 0,
  travel_miles REAL,
  time_zones_crossed INTEGER,
  schedule_stress_score REAL,
  stress_flags_json TEXT,
  source_updated_at TEXT,
  raw_json TEXT,
  UNIQUE(season_id,team_key,game_id)
);
CREATE INDEX IF NOT EXISTS idx_nhl_team_schedule_team_time
  ON nhl_team_schedule_profile(season_id,team_key,start_time);

CREATE TABLE IF NOT EXISTS nhl_team_profile_snapshots (
  id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  season_id INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_team_profile_snapshots_time
  ON nhl_team_profile_snapshots(team_key,as_of DESC);

CREATE TABLE IF NOT EXISTS nhl_team_coach_history (
  id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  season_id INTEGER NOT NULL,
  coach_name TEXT NOT NULL,
  role TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nhl_team_coach_history_team
  ON nhl_team_coach_history(team_key,observed_at DESC);

CREATE TABLE IF NOT EXISTS nhl_profile_sync_runs (
  id TEXT PRIMARY KEY,
  season_id INTEGER NOT NULL,
  team_key TEXT,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  source_calls INTEGER NOT NULL DEFAULT 0,
  roster_rows INTEGER NOT NULL DEFAULT 0,
  schedule_rows INTEGER NOT NULL DEFAULT 0,
  player_rows_upserted INTEGER NOT NULL DEFAULT 0,
  goalie_rows_upserted INTEGER NOT NULL DEFAULT 0,
  linemate_rows_upserted INTEGER NOT NULL DEFAULT 0,
  deployment_rows_upserted INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_nhl_profile_sync_runs_time
  ON nhl_profile_sync_runs(started_at DESC,team_key);


-- Tennis persistent player bank (migration 0053)
-- Persistent FBIS tennis player bank + matchup history.
-- Research-only. Historical observations are immutable; current bank is a materialized state.

CREATE TABLE IF NOT EXISTS tennis_player_bank (
  tour TEXT NOT NULL,
  player_key TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  country TEXT,
  handedness TEXT,
  birth_date TEXT,
  headshot_url TEXT,
  current_rank INTEGER,
  ranking_points INTEGER,
  profile_json TEXT NOT NULL,
  recent_form_json TEXT,
  source TEXT NOT NULL,
  source_as_of TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tour, player_key)
);
CREATE INDEX IF NOT EXISTS idx_tennis_player_bank_rank ON tennis_player_bank(tour,current_rank);
CREATE INDEX IF NOT EXISTS idx_tennis_player_bank_id ON tennis_player_bank(player_id);

CREATE TABLE IF NOT EXISTS tennis_match_history (
  match_key TEXT PRIMARY KEY,
  tour TEXT NOT NULL,
  match_date TEXT NOT NULL,
  tournament TEXT,
  surface TEXT,
  round TEXT,
  player1_key TEXT NOT NULL,
  player1_name TEXT NOT NULL,
  player2_key TEXT NOT NULL,
  player2_name TEXT NOT NULL,
  winner_key TEXT,
  score TEXT,
  player1_rank INTEGER,
  player2_rank INTEGER,
  player1_stats_json TEXT,
  player2_stats_json TEXT,
  source TEXT NOT NULL,
  source_as_of TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tennis_history_p1 ON tennis_match_history(tour,player1_key,match_date DESC);
CREATE INDEX IF NOT EXISTS idx_tennis_history_p2 ON tennis_match_history(tour,player2_key,match_date DESC);


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


-- Durable soccer competition provider registry (migration 0062).
CREATE TABLE IF NOT EXISTS soccer_competition_provider_map (
  heritage_name TEXT PRIMARY KEY,
  heritage_key TEXT,
  canonical_competition_id TEXT,
  provider TEXT NOT NULL DEFAULT 'pitchapi',
  provider_competition_id TEXT,
  provider_name TEXT,
  provider_aliases_json TEXT,
  mapping_source TEXT NOT NULL DEFAULT 'DISCOVERY',
  confidence REAL,
  verified_manual INTEGER NOT NULL DEFAULT 0,
  last_checked TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_soccer_provider_map_provider
  ON soccer_competition_provider_map(provider,provider_competition_id);


-- Soccer Phase 3 persistent state research bank (migration 0063).
CREATE TABLE IF NOT EXISTS soccer_team_state (
  team_id TEXT PRIMARY KEY, team_name TEXT, league_key TEXT, manager_name TEXT, primary_formation TEXT,
  goalkeeper_player_id TEXT, goalkeeper_name TEXT, latest_lineup_match_id TEXT, latest_lineup_observed_at TEXT,
  latest_lineup_confirmed INTEGER NOT NULL DEFAULT 0, lineup_continuity_5 REAL, rotation_index_5 REAL,
  matches_14 INTEGER NOT NULL DEFAULT 0, matches_28 INTEGER NOT NULL DEFAULT 0, competition_count_28 INTEGER NOT NULL DEFAULT 0,
  rest_days REAL, travel_km_14 REAL, travel_source TEXT, state_as_of TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1, can_influence_projection INTEGER NOT NULL DEFAULT 0,
  source_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS soccer_player_state (
  player_id TEXT PRIMARY KEY, team_id TEXT NOT NULL, player_name TEXT, role_state TEXT,
  availability_status TEXT NOT NULL DEFAULT 'UNKNOWN', availability_reason TEXT, availability_source TEXT, availability_observed_at TEXT,
  expected_xi_state TEXT NOT NULL DEFAULT 'UNKNOWN', last_match_date TEXT, last_start_date TEXT,
  appearances_28 INTEGER NOT NULL DEFAULT 0, starts_5 INTEGER NOT NULL DEFAULT 0,
  minutes_7 REAL NOT NULL DEFAULT 0, minutes_14 REAL NOT NULL DEFAULT 0, minutes_28 REAL NOT NULL DEFAULT 0,
  load_index_28 REAL, replacement_rank REAL, goalkeeper_evidence INTEGER NOT NULL DEFAULT 0, state_as_of TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1, can_influence_projection INTEGER NOT NULL DEFAULT 0,
  source_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS soccer_availability_observations (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, team_id TEXT, status TEXT NOT NULL, reason TEXT, source TEXT NOT NULL,
  source_ref TEXT, observed_at TEXT NOT NULL, valid_from TEXT, valid_until TEXT, verified INTEGER NOT NULL DEFAULT 0,
  research_only INTEGER NOT NULL DEFAULT 1, can_influence_projection INTEGER NOT NULL DEFAULT 0, raw_json TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS soccer_team_state_snapshots (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL, league_key TEXT, target_match_id TEXT, snapshot_as_of TEXT NOT NULL,
  data_cutoff TEXT NOT NULL, state_json TEXT NOT NULL, research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS soccer_player_state_snapshots (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, team_id TEXT NOT NULL, target_match_id TEXT, snapshot_as_of TEXT NOT NULL,
  data_cutoff TEXT NOT NULL, state_json TEXT NOT NULL, research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);


-- Soccer Phase 3 validation evidence ledger (migration 0064).
CREATE TABLE IF NOT EXISTS soccer_validation_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  heritage_key TEXT,
  model_version TEXT NOT NULL,
  model_variant TEXT NOT NULL,
  benchmark_variant TEXT,
  market_family TEXT NOT NULL,
  line_key TEXT,
  sample_n INTEGER NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL,
  point_in_time INTEGER NOT NULL DEFAULT 1,
  market_used INTEGER NOT NULL DEFAULT 0,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  evaluated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  snapshot_id TEXT,
  code_sha TEXT,
  UNIQUE(run_id,heritage_key,model_variant,market_family,line_key)
);
CREATE INDEX IF NOT EXISTS idx_soccer_validation_evidence_lookup
  ON soccer_validation_evidence(heritage_key,model_version,market_family,evaluated_at DESC);

-- NHL goalie probability prospective shadow freeze/grade ledger.
-- Research only. Never grants qualification, wager authority, or staking.

CREATE TABLE IF NOT EXISTS nhl_goalie_probability_shadow (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  game_start TEXT,
  feature_cutoff_timestamp TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  incumbent_model_id TEXT NOT NULL,
  gate_id TEXT NOT NULL,
  gate_fired INTEGER NOT NULL DEFAULT 0,
  historical_gate_validated INTEGER NOT NULL DEFAULT 0,
  goalie_probability_scale REAL NOT NULL,
  incumbent_home_win_probability REAL,
  shadow_home_win_probability REAL,
  projected_home REAL,
  projected_away REAL,
  goalie_state_json TEXT,
  ev_deployment_json TEXT,
  pp_deployment_json TEXT,
  scratches_availability_json TEXT,
  replacement_mapping_json TEXT,
  persistent_state_json TEXT,
  market_snapshot_json TEXT,
  code_sha TEXT,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  staking_authorized INTEGER NOT NULL DEFAULT 0,
  actual_home REAL,
  actual_away REAL,
  incumbent_brier REAL,
  shadow_brier REAL,
  incumbent_log_loss REAL,
  shadow_log_loss REAL,
  incumbent_correct INTEGER,
  shadow_correct INTEGER,
  research_clv_probability_pp REAL,
  research_profit_units REAL,
  grade_json TEXT,
  graded_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(event_id,model_version)
);
CREATE INDEX IF NOT EXISTS idx_nhl_goalie_shadow_event
  ON nhl_goalie_probability_shadow(event_id,feature_cutoff_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_nhl_goalie_shadow_grade
  ON nhl_goalie_probability_shadow(graded_at,feature_cutoff_timestamp);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0066_nhl_goalie_probability_shadow',datetime('now'));



-- CFB persistent directory Phase A (migration 0067).
CREATE TABLE IF NOT EXISTS cfb_canonical_teams (team_id TEXT PRIMARY KEY, school_name TEXT NOT NULL, athletic_name TEXT, abbreviation TEXT, subdivision TEXT NOT NULL DEFAULT 'UNKNOWN', current_conference TEXT, independent INTEGER NOT NULL DEFAULT 0, city TEXT, state TEXT, country TEXT DEFAULT 'USA', home_venue_id TEXT, home_stadium TEXT, latitude REAL, longitude REAL, timezone TEXT, elevation_feet REAL, active INTEGER NOT NULL DEFAULT 1, identity_confidence REAL, research_only INTEGER NOT NULL DEFAULT 1, can_influence_projection INTEGER NOT NULL DEFAULT 0, source_json TEXT, first_observed_at TEXT NOT NULL, last_observed_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cfb_team_aliases (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, alias TEXT NOT NULL, normalized_alias TEXT NOT NULL, alias_type TEXT NOT NULL DEFAULT 'NAME', source TEXT NOT NULL, effective_from TEXT, effective_to TEXT, observed_at TEXT NOT NULL, confidence REAL, created_at TEXT NOT NULL, UNIQUE(team_id,normalized_alias,source,effective_from));
CREATE TABLE IF NOT EXISTS cfb_team_provider_ids (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, provider TEXT NOT NULL, provider_team_id TEXT NOT NULL, provider_team_name TEXT, effective_from TEXT, effective_to TEXT, observed_at TEXT NOT NULL, confidence REAL, raw_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(provider,provider_team_id,effective_from));
CREATE TABLE IF NOT EXISTS cfb_conference_membership (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, conference_id TEXT, conference_name TEXT, subdivision TEXT, independent INTEGER NOT NULL DEFAULT 0, effective_from TEXT NOT NULL, effective_to TEXT, source TEXT NOT NULL, observed_at TEXT NOT NULL, confidence REAL, raw_json TEXT, created_at TEXT NOT NULL, UNIQUE(team_id,effective_from,conference_name));
CREATE TABLE IF NOT EXISTS cfb_team_identity_observations (id TEXT PRIMARY KEY, team_id TEXT, provider TEXT NOT NULL, provider_team_id TEXT, school_name TEXT NOT NULL, conference_name TEXT, subdivision TEXT, payload_json TEXT NOT NULL, source_timestamp TEXT, observed_at TEXT NOT NULL, ingested_at TEXT NOT NULL, content_hash TEXT, supersedes_id TEXT, confidence REAL, research_only INTEGER NOT NULL DEFAULT 1, can_influence_projection INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS cfb_state_overlay_governance (state_family TEXT PRIMARY KEY, overlay_version TEXT NOT NULL DEFAULT 'FBIS-STATE-OVERLAY-v1', mode TEXT NOT NULL DEFAULT 'RESEARCH', can_influence_projection INTEGER NOT NULL DEFAULT 0, can_qualify INTEGER NOT NULL DEFAULT 0, can_authorize_wager INTEGER NOT NULL DEFAULT 0, notes TEXT, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_cfb_canonical_teams_subdivision ON cfb_canonical_teams(subdivision,active,current_conference);
CREATE INDEX IF NOT EXISTS idx_cfb_team_alias_lookup ON cfb_team_aliases(normalized_alias,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_cfb_team_provider_team ON cfb_team_provider_ids(team_id,provider,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_cfb_conference_membership_pit ON cfb_conference_membership(team_id,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_cfb_conference_membership_conf ON cfb_conference_membership(conference_name,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_cfb_team_identity_obs_team_time ON cfb_team_identity_observations(team_id,observed_at DESC);


-- NBA official observation ingestion health (migration 0068).
CREATE TABLE IF NOT EXISTS nba_observation_health (
  path_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  last_attempted_fetch TEXT NOT NULL,
  last_successful_fetch TEXT,
  source_row_count INTEGER NOT NULL DEFAULT 0,
  normalized_row_count INTEGER NOT NULL DEFAULT 0,
  persisted_row_count INTEGER NOT NULL DEFAULT 0,
  rejected_row_count INTEGER NOT NULL DEFAULT 0,
  zero_row_reason TEXT,
  source_freshness TEXT,
  error_state TEXT,
  detail_json TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nba_observation_health_updated ON nba_observation_health(updated_at DESC);

-- NHL goalie-shadow prospective integrity/provenance fields.
-- Additive only. Research/shadow only; no qualification or wager authority.

ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'FROZEN';
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN home_goalie_confirmation_state TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN away_goalie_confirmation_state TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN home_expected_starter_id TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN away_expected_starter_id TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN home_expected_starter_name TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN away_expected_starter_name TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN home_expected_start_probability REAL;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN away_expected_start_probability REAL;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN goalie_evidence_source TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN goalie_evidence_at TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN deployment_evidence_at TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN availability_evidence_at TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN market_observed_at TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN temporal_integrity_passed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN temporal_integrity_json TEXT;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN probability_delta REAL;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN starter_quality_delta REAL;
ALTER TABLE nhl_goalie_probability_shadow ADD COLUMN goalie_usage_state TEXT;

CREATE INDEX IF NOT EXISTS idx_nhl_goalie_shadow_lifecycle
  ON nhl_goalie_probability_shadow(lifecycle,graded_at,feature_cutoff_timestamp);
CREATE INDEX IF NOT EXISTS idx_nhl_goalie_shadow_integrity
  ON nhl_goalie_probability_shadow(temporal_integrity_passed,feature_cutoff_timestamp);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0069_nhl_goalie_shadow_integrity_v2',datetime('now'));



-- FBIS cross-sport canonical state/evidence/economic ledgers (migration 0070)
CREATE TABLE IF NOT EXISTS fbis_state_observations (
  observation_id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  state_family TEXT NOT NULL,
  state_value_json TEXT,
  source TEXT NOT NULL,
  evidence_class TEXT,
  evidence_rank REAL NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  expires_at TEXT,
  supersedes_observation_id TEXT,
  provenance_json TEXT,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fbis_state_observations_entity
  ON fbis_state_observations (sport, entity_type, entity_id, state_family, effective_at DESC);

CREATE TABLE IF NOT EXISTS fbis_prospective_evidence (
  evidence_id TEXT PRIMARY KEY,
  contract_version TEXT NOT NULL,
  sport TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_start_at TEXT,
  snapshot_at TEXT NOT NULL,
  champion_model_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT,
  lifecycle TEXT NOT NULL,
  gate_version TEXT,
  state_snapshot_id TEXT,
  market_snapshot_id TEXT,
  market_observed_at TEXT,
  code_sha TEXT,
  incumbent_projection_json TEXT,
  challenger_projection_json TEXT,
  governance_json TEXT,
  temporal_integrity INTEGER NOT NULL DEFAULT 0,
  legacy INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  graded_at TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fbis_prospective_evidence_cohort
  ON fbis_prospective_evidence (sport, model_id, gate_version, lifecycle, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_fbis_prospective_evidence_event
  ON fbis_prospective_evidence (sport, event_id, snapshot_at);

CREATE TABLE IF NOT EXISTS fbis_economic_grades (
  grade_id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  sport TEXT NOT NULL,
  event_id TEXT NOT NULL,
  market_family TEXT NOT NULL,
  selection TEXT NOT NULL,
  projected_probability REAL,
  entry_line REAL,
  entry_price REAL,
  entry_no_vig_probability REAL,
  close_line REAL,
  close_price REAL,
  close_no_vig_probability REAL,
  result TEXT,
  clv_probability REAL,
  profit_units REAL,
  roi REAL,
  brier REAL,
  log_loss REAL,
  graded_at TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fbis_economic_grades_model_evidence
  ON fbis_economic_grades (sport, market_family, evidence_id);


-- MLB prospective player-prop evidence (migration 0071).
CREATE TABLE IF NOT EXISTS mlb_prop_prospective_evidence (
  id TEXT PRIMARY KEY,
  gate_version TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  event_start_at TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  opponent TEXT,
  position TEXT,
  market TEXT NOT NULL,
  projection REAL NOT NULL,
  sigma REAL,
  model_source TEXT NOT NULL,
  model_version TEXT NOT NULL,
  source_observed_at TEXT,
  state_as_of TEXT NOT NULL,
  projection_snapshot_at TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  market_source TEXT NOT NULL,
  sportsbook TEXT,
  market_line REAL NOT NULL,
  odds_tier TEXT,
  market_observed_at TEXT NOT NULL,
  decision_snapshot_at TEXT NOT NULL,
  candidate_side TEXT,
  state_snapshot_json TEXT NOT NULL,
  projection_json TEXT NOT NULL,
  market_json TEXT NOT NULL,
  temporal_integrity INTEGER NOT NULL DEFAULT 0,
  temporal_diagnostics_json TEXT,
  duplicate_key TEXT NOT NULL,
  projection_unit_key TEXT,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  actual_value REAL,
  result TEXT,
  settled_at TEXT,
  settlement_source TEXT,
  settlement_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mlb_prop_evidence_duplicate ON mlb_prop_prospective_evidence (duplicate_key);
CREATE INDEX IF NOT EXISTS idx_mlb_prop_evidence_market ON mlb_prop_prospective_evidence (market, model_version, event_date, projection_snapshot_at);
CREATE INDEX IF NOT EXISTS idx_mlb_prop_evidence_pending ON mlb_prop_prospective_evidence (event_date, event_id, settled_at, temporal_integrity);
CREATE INDEX IF NOT EXISTS idx_mlb_prop_evidence_projection_unit ON mlb_prop_prospective_evidence (projection_unit_key, event_date, settled_at);

CREATE TABLE IF NOT EXISTS mlb_prop_evidence_rejections (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  event_id TEXT,
  player_id TEXT,
  player_name TEXT,
  market TEXT,
  reason TEXT NOT NULL,
  details_json TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mlb_prop_evidence_rejections_date ON mlb_prop_evidence_rejections (observed_at, reason);

CREATE TABLE IF NOT EXISTS mlb_prop_evidence_runs (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  event_date TEXT,
  shard INTEGER,
  shards INTEGER,
  status TEXT NOT NULL,
  attempted INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0,
  missing_outcomes INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- Tennis canonical Player Bank identity/observation layer (migration 0073).
-- Canonical Tennis Player Bank identity + immutable observation layer.
-- Official ATP/WTA sources own identity/profile state; derived FBIS state remains separate.

CREATE TABLE IF NOT EXISTS tennis_players (
  fbis_player_id TEXT PRIMARY KEY,
  tour TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  country_code TEXT,
  sex TEXT,
  date_of_birth TEXT,
  height_cm REAL,
  weight_kg REAL,
  handedness TEXT,
  backhand TEXT,
  turned_pro_year INTEGER,
  coach TEXT,
  active_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  official_headshot_url TEXT,
  official_headshot_source TEXT,
  current_rank INTEGER,
  ranking_points INTEGER,
  career_high_rank INTEGER,
  career_wins INTEGER,
  career_losses INTEGER,
  titles INTEGER,
  prize_money_usd REAL,
  official_source TEXT,
  official_source_player_id TEXT,
  official_source_priority INTEGER NOT NULL DEFAULT 0,
  official_effective_at TEXT,
  official_observed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tennis_players_tour_name ON tennis_players(tour, normalized_name);
CREATE INDEX IF NOT EXISTS idx_tennis_players_rank ON tennis_players(tour, current_rank);
CREATE INDEX IF NOT EXISTS idx_tennis_players_official_id ON tennis_players(official_source, official_source_player_id);

CREATE TABLE IF NOT EXISTS tennis_player_source_ids (
  provider TEXT NOT NULL,
  source_player_id TEXT NOT NULL,
  fbis_player_id TEXT NOT NULL,
  source_name TEXT,
  normalized_source_name TEXT,
  source_priority INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  provenance_json TEXT,
  PRIMARY KEY (provider, source_player_id),
  FOREIGN KEY (fbis_player_id) REFERENCES tennis_players(fbis_player_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_source_ids_fbis ON tennis_player_source_ids(fbis_player_id);

CREATE TABLE IF NOT EXISTS tennis_player_aliases (
  alias_normalized TEXT NOT NULL,
  fbis_player_id TEXT NOT NULL,
  alias_display TEXT,
  source TEXT NOT NULL,
  source_priority INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (alias_normalized, fbis_player_id, source),
  FOREIGN KEY (fbis_player_id) REFERENCES tennis_players(fbis_player_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_alias_lookup ON tennis_player_aliases(alias_normalized, active);

CREATE TABLE IF NOT EXISTS tennis_profile_observations (
  observation_id TEXT PRIMARY KEY,
  fbis_player_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_player_id TEXT,
  field_name TEXT NOT NULL,
  value_text TEXT,
  value_num REAL,
  effective_at TEXT,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  provenance_json TEXT,
  confidence REAL,
  superseded_by TEXT,
  source_priority INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (fbis_player_id) REFERENCES tennis_players(fbis_player_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_profile_obs_current ON tennis_profile_observations(fbis_player_id, field_name, effective_at DESC, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tennis_profile_obs_source ON tennis_profile_observations(source, source_player_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS tennis_ranking_observations (
  observation_id TEXT PRIMARY KEY,
  fbis_player_id TEXT NOT NULL,
  tour TEXT NOT NULL,
  ranking_date TEXT NOT NULL,
  singles_rank INTEGER,
  points INTEGER,
  movement INTEGER,
  tournaments_played INTEGER,
  career_high_rank INTEGER,
  source TEXT NOT NULL,
  source_player_id TEXT,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  provenance_json TEXT,
  source_priority INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (fbis_player_id) REFERENCES tennis_players(fbis_player_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tennis_rank_unique
  ON tennis_ranking_observations(fbis_player_id, ranking_date, source);
CREATE INDEX IF NOT EXISTS idx_tennis_rank_pit
  ON tennis_ranking_observations(fbis_player_id, ranking_date DESC, observed_at DESC);

CREATE TABLE IF NOT EXISTS tennis_performance_observations (
  observation_id TEXT PRIMARY KEY,
  fbis_player_id TEXT NOT NULL,
  tour TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_value TEXT,
  metric_name TEXT NOT NULL,
  raw_value REAL,
  normalized_value REAL,
  sample_matches INTEGER,
  source TEXT NOT NULL,
  source_player_id TEXT,
  effective_at TEXT,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  provenance_json TEXT,
  source_priority INTEGER NOT NULL DEFAULT 0,
  derived INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (fbis_player_id) REFERENCES tennis_players(fbis_player_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_perf_pit
  ON tennis_performance_observations(fbis_player_id, metric_name, scope_type, scope_value, effective_at DESC, observed_at DESC);

CREATE TABLE IF NOT EXISTS tennis_availability_observations (
  observation_id TEXT PRIMARY KEY,
  fbis_player_id TEXT NOT NULL,
  state TEXT NOT NULL,
  detail TEXT,
  source TEXT NOT NULL,
  source_player_id TEXT,
  effective_at TEXT,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  provenance_json TEXT,
  confidence REAL,
  FOREIGN KEY (fbis_player_id) REFERENCES tennis_players(fbis_player_id)
);
CREATE INDEX IF NOT EXISTS idx_tennis_availability_pit
  ON tennis_availability_observations(fbis_player_id, effective_at DESC, observed_at DESC);

CREATE TABLE IF NOT EXISTS tennis_ingestion_state (
  source TEXT NOT NULL,
  tour TEXT NOT NULL,
  stream TEXT NOT NULL,
  cursor_value TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_written INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_started_at TEXT,
  last_success_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source, tour, stream)
);



-- NBA Phase 3 prospective profile ablation (migration 0069).
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



-- CFB persistent player directory Phase B (migration 0075).
-- CFB persistent directory Phase B: canonical players and temporal rosters.
-- FBIS-STATE-OVERLAY-v1. Identity/state infrastructure only; no projection, qualification, or wager authority.

CREATE TABLE IF NOT EXISTS cfb_canonical_players (
  player_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  current_position TEXT,
  active INTEGER,
  identity_status TEXT NOT NULL DEFAULT 'RESOLVED',
  identity_confidence REAL,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  source_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cfb_canonical_players_name
  ON cfb_canonical_players(canonical_name,active);
CREATE INDEX IF NOT EXISTS idx_cfb_canonical_players_identity
  ON cfb_canonical_players(identity_status,identity_confidence);

CREATE TABLE IF NOT EXISTS cfb_player_provider_ids (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_player_id TEXT NOT NULL,
  provider_name TEXT,
  effective_from TEXT,
  effective_to TEXT,
  observed_at TEXT NOT NULL,
  confidence REAL,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider,provider_player_id,effective_from)
);
CREATE INDEX IF NOT EXISTS idx_cfb_player_provider_lookup
  ON cfb_player_provider_ids(provider,provider_player_id,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_cfb_player_provider_player
  ON cfb_player_provider_ids(player_id,provider);

CREATE TABLE IF NOT EXISTS cfb_player_aliases (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_type TEXT NOT NULL DEFAULT 'NAME',
  source TEXT NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  observed_at TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL,
  UNIQUE(player_id,normalized_alias,source,effective_from)
);
CREATE INDEX IF NOT EXISTS idx_cfb_player_alias_lookup
  ON cfb_player_aliases(normalized_alias,effective_from,effective_to);

CREATE TABLE IF NOT EXISTS cfb_roster_membership (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  team_id TEXT,
  provider_team_id TEXT,
  season INTEGER NOT NULL,
  position TEXT,
  position_abbreviation TEXT,
  jersey TEXT,
  class_year TEXT,
  height REAL,
  weight REAL,
  first_game_id TEXT,
  first_week INTEGER,
  first_game_at TEXT,
  last_game_id TEXT,
  last_week INTEGER,
  last_game_at TEXT,
  games_rostered INTEGER,
  pit_resolvable INTEGER NOT NULL DEFAULT 1,
  temporal_confidence REAL,
  effective_from TEXT NOT NULL,
  effective_to TEXT NOT NULL,
  source TEXT NOT NULL,
  source_timestamp TEXT,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  confidence REAL,
  raw_json TEXT,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  UNIQUE(player_id,team_id,season,source)
);
CREATE INDEX IF NOT EXISTS idx_cfb_roster_team_pit
  ON cfb_roster_membership(team_id,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_cfb_roster_player_pit
  ON cfb_roster_membership(player_id,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_cfb_roster_season_team
  ON cfb_roster_membership(season,team_id);

CREATE TABLE IF NOT EXISTS cfb_roster_observations (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  team_id TEXT,
  provider TEXT NOT NULL,
  provider_player_id TEXT,
  provider_team_id TEXT,
  season INTEGER NOT NULL,
  position TEXT,
  jersey TEXT,
  class_year TEXT,
  first_game_id TEXT,
  first_week INTEGER,
  first_game_at TEXT,
  last_game_id TEXT,
  last_week INTEGER,
  last_game_at TEXT,
  games_rostered INTEGER,
  pit_resolvable INTEGER NOT NULL DEFAULT 1,
  temporal_confidence REAL,
  payload_json TEXT NOT NULL,
  source_timestamp TEXT,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  confidence REAL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  UNIQUE(provider,provider_player_id,provider_team_id,season,content_hash)
);
CREATE INDEX IF NOT EXISTS idx_cfb_roster_obs_player_time
  ON cfb_roster_observations(player_id,season,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cfb_roster_obs_team_time
  ON cfb_roster_observations(team_id,season,observed_at DESC);

CREATE TABLE IF NOT EXISTS cfb_roster_source_coverage (
  season INTEGER NOT NULL,
  source TEXT NOT NULL,
  roster_rows INTEGER NOT NULL DEFAULT 0,
  distinct_players INTEGER NOT NULL DEFAULT 0,
  distinct_teams INTEGER NOT NULL DEFAULT 0,
  resolved_team_rows INTEGER NOT NULL DEFAULT 0,
  orphan_team_rows INTEGER NOT NULL DEFAULT 0,
  provisional_players INTEGER NOT NULL DEFAULT 0,
  pit_unresolved_memberships INTEGER NOT NULL DEFAULT 0,
  game_roster_rows INTEGER,
  source_file TEXT,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(season,source)
);

INSERT OR IGNORE INTO cfb_state_overlay_governance
(state_family,overlay_version,mode,can_influence_projection,can_qualify,can_authorize_wager,notes,updated_at)
VALUES
('PLAYER_DIRECTORY','FBIS-STATE-OVERLAY-v1','ACTIVE_INFRASTRUCTURE',0,0,0,'Canonical CFB player identity only; no projection weight.',datetime('now')),
('ROSTER_STATE','FBIS-STATE-OVERLAY-v1','RESEARCH',0,0,0,'Temporal CFB roster state; no projection, qualification, or wager authority.',datetime('now'));


-- Tennis WTA ranked-universe reconciliation (migration 0076).
-- WTA ranked-universe reconciliation, identity review, source audit, and ranking PIT hardening.

DROP INDEX IF EXISTS idx_tennis_rank_unique;
CREATE INDEX IF NOT EXISTS idx_tennis_rank_same_date
  ON tennis_ranking_observations(fbis_player_id, ranking_date, source, observed_at DESC);

CREATE TABLE IF NOT EXISTS tennis_identity_review_queue (
  review_id TEXT PRIMARY KEY,
  tour TEXT NOT NULL,
  source TEXT NOT NULL,
  source_player_id TEXT,
  source_name TEXT,
  normalized_source_name TEXT,
  issue_type TEXT NOT NULL,
  candidate_fbis_player_ids_json TEXT,
  detail_json TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_tennis_identity_review_open
  ON tennis_identity_review_queue(tour,source,status,issue_type,last_observed_at DESC);

CREATE TABLE IF NOT EXISTS tennis_source_audits (
  audit_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  tour TEXT NOT NULL,
  endpoint_key TEXT NOT NULL,
  endpoint_path TEXT NOT NULL,
  http_status INTEGER,
  available INTEGER NOT NULL DEFAULT 0,
  sample_count INTEGER,
  earliest_date TEXT,
  latest_date TEXT,
  field_inventory_json TEXT,
  detail_json TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tennis_source_audits_latest
  ON tennis_source_audits(source,tour,endpoint_key,observed_at DESC);

DROP TRIGGER IF EXISTS trg_tennis_players_source_priority;
CREATE TRIGGER trg_tennis_players_source_priority
BEFORE UPDATE OF canonical_name,country_code,date_of_birth,height_cm,weight_kg,handedness,backhand,
  turned_pro_year,coach,official_headshot_url,current_rank,ranking_points,career_high_rank,
  career_wins,career_losses,titles,prize_money_usd,official_source,official_source_player_id,
  official_source_priority
ON tennis_players
WHEN NEW.official_source_priority < OLD.official_source_priority
BEGIN
  SELECT RAISE(ABORT,'tennis official source priority violation');
END;


CREATE INDEX IF NOT EXISTS idx_cfb_roster_pit_resolvable
  ON cfb_roster_membership(player_id,season,pit_resolvable,effective_from,effective_to);


-- KBO / NPB Phase 2 durable historical game/result foundation.
CREATE TABLE IF NOT EXISTS asian_baseball_games (
  canonical_game_id TEXT PRIMARY KEY,
  league TEXT NOT NULL CHECK (league IN ('KBO','NPB')),
  season INTEGER NOT NULL,
  source_game_id TEXT,
  game_date TEXT NOT NULL,
  scheduled_start TEXT,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  venue TEXT,
  game_status TEXT NOT NULL,
  home_final_runs INTEGER,
  away_final_runs INTEGER,
  innings_status_json TEXT,
  source_contract TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  result_observed_at TEXT,
  first_fetched_at TEXT NOT NULL,
  last_fetched_at TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  is_final INTEGER NOT NULL DEFAULT 0,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asian_baseball_source_game
  ON asian_baseball_games(league,source_game_id)
  WHERE source_game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asian_baseball_games_league_date
  ON asian_baseball_games(league,game_date,canonical_game_id);
CREATE INDEX IF NOT EXISTS idx_asian_baseball_games_team_date
  ON asian_baseball_games(league,home_team_id,away_team_id,game_date);

CREATE TABLE IF NOT EXISTS asian_baseball_game_observations (
  id TEXT PRIMARY KEY,
  canonical_game_id TEXT NOT NULL,
  league TEXT NOT NULL CHECK (league IN ('KBO','NPB')),
  observation_type TEXT NOT NULL,
  relation_to_start TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  source_contract TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  payload_json TEXT,
  research_only INTEGER NOT NULL DEFAULT 1,
  pregame_eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(canonical_game_id) REFERENCES asian_baseball_games(canonical_game_id)
);
CREATE INDEX IF NOT EXISTS idx_asian_baseball_obs_game_time
  ON asian_baseball_game_observations(canonical_game_id,observed_at);
CREATE INDEX IF NOT EXISTS idx_asian_baseball_obs_temporal
  ON asian_baseball_game_observations(league,relation_to_start,observed_at);

CREATE TABLE IF NOT EXISTS asian_baseball_backfill_shards (
  id TEXT PRIMARY KEY,
  league TEXT NOT NULL CHECK (league IN ('KBO','NPB')),
  season INTEGER NOT NULL,
  month INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  cursor_date TEXT,
  max_requests INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','RUNNING','PARTIAL','DONE','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  requests_used INTEGER NOT NULL DEFAULT 0,
  games_discovered INTEGER NOT NULL DEFAULT 0,
  games_persisted INTEGER NOT NULL DEFAULT 0,
  malformed_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  lease_until TEXT,
  source_contract TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_asian_baseball_backfill_status
  ON asian_baseball_backfill_shards(status,league,season,month);


-- Soccer Phase 3F research-only routing registry + prospective shadow ledger (migration 0079).
CREATE TABLE IF NOT EXISTS soccer_research_routes (
  route_id TEXT PRIMARY KEY,
  route_version TEXT NOT NULL,
  competition_key TEXT NOT NULL,
  market_family TEXT NOT NULL,
  incumbent_model_id TEXT NOT NULL,
  challenger_model_id TEXT NOT NULL,
  evidence_snapshot_id TEXT NOT NULL,
  evidence_code_sha TEXT NOT NULL,
  evidence_sample_n INTEGER NOT NULL,
  validation_classification TEXT NOT NULL CHECK(validation_classification IN ('PASS','PARTIAL_PASS','FAIL','INSUFFICIENT_EVIDENCE')),
  approval_state TEXT NOT NULL,
  historical_market_status TEXT NOT NULL,
  shadow_eligible INTEGER NOT NULL DEFAULT 0,
  research_only INTEGER NOT NULL DEFAULT 1 CHECK(research_only=1),
  can_qualify INTEGER NOT NULL DEFAULT 0 CHECK(can_qualify=0),
  can_authorize INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize=0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(route_version,competition_key,market_family)
);
CREATE INDEX IF NOT EXISTS idx_soccer_research_routes_lookup
  ON soccer_research_routes(competition_key,market_family,route_version);
CREATE INDEX IF NOT EXISTS idx_soccer_research_routes_evidence
  ON soccer_research_routes(evidence_snapshot_id,evidence_code_sha,validation_classification);

CREATE TABLE IF NOT EXISTS soccer_prospective_shadow (
  shadow_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  competition_key TEXT NOT NULL,
  market_family TEXT NOT NULL,
  selection TEXT NOT NULL,
  event_start_at TEXT,
  snapshot_at TEXT NOT NULL,
  route_id TEXT NOT NULL,
  route_version TEXT NOT NULL,
  evidence_snapshot_id TEXT NOT NULL,
  evidence_code_sha TEXT NOT NULL,
  incumbent_model_id TEXT NOT NULL,
  challenger_model_id TEXT NOT NULL,
  selected_research_model_id TEXT NOT NULL,
  v2_probability REAL,
  v31_probability REAL,
  market_no_vig_probability REAL,
  entry_line REAL,
  entry_price REAL,
  line_timestamp TEXT,
  close_line REAL,
  close_price REAL,
  close_no_vig_probability REAL,
  close_timestamp TEXT,
  realized_result TEXT,
  clv_probability REAL,
  simulated_profit_units REAL,
  simulated_roi REAL,
  market_history_available INTEGER NOT NULL DEFAULT 0,
  market_unavailable_reason TEXT,
  graded_at TEXT,
  provenance_json TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1 CHECK(research_only=1),
  can_qualify INTEGER NOT NULL DEFAULT 0 CHECK(can_qualify=0),
  can_authorize INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize=0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id,market_family,selection,snapshot_at),
  FOREIGN KEY(route_id) REFERENCES soccer_research_routes(route_id)
);
CREATE INDEX IF NOT EXISTS idx_soccer_prospective_shadow_event
  ON soccer_prospective_shadow(event_id,market_family,snapshot_at);
CREATE INDEX IF NOT EXISTS idx_soccer_prospective_shadow_route
  ON soccer_prospective_shadow(route_id,graded_at,snapshot_at);
CREATE INDEX IF NOT EXISTS idx_soccer_prospective_shadow_grade
  ON soccer_prospective_shadow(competition_key,market_family,graded_at,snapshot_at);

-- Canonical bundle mirror: CBB persistent directory Phase A (migration 0079).
-- CBB persistent team/player directory Phase A.
-- FBIS-STATE-OVERLAY-v1 research infrastructure only.
-- No projection weight, qualification, totals activation, or wager authority.

CREATE TABLE IF NOT EXISTS cbb_canonical_teams (
  team_id TEXT PRIMARY KEY,
  espn_team_id TEXT,
  school_name TEXT NOT NULL,
  display_name TEXT,
  abbreviation TEXT,
  classification TEXT NOT NULL DEFAULT 'UNKNOWN',
  active INTEGER NOT NULL DEFAULT 1,
  current_conference TEXT,
  home_venue TEXT,
  hca_reference REAL,
  head_coach_name TEXT,
  coach_tenure_start TEXT,
  identity_confidence REAL,
  source_json TEXT,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cbb_team_espn ON cbb_canonical_teams(espn_team_id) WHERE espn_team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cbb_team_active ON cbb_canonical_teams(active,classification);

CREATE TABLE IF NOT EXISTS cbb_team_aliases (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source TEXT NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  observed_at TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL,
  UNIQUE(team_id,normalized_alias,source,effective_from)
);
CREATE INDEX IF NOT EXISTS idx_cbb_team_alias_lookup ON cbb_team_aliases(normalized_alias,effective_from,effective_to);

CREATE TABLE IF NOT EXISTS cbb_conference_membership (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  conference_name TEXT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence REAL,
  provenance_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_conf_pit ON cbb_conference_membership(team_id,effective_from,effective_to);

CREATE TABLE IF NOT EXISTS cbb_players (
  player_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  identity_status TEXT NOT NULL DEFAULT 'PROVISIONAL',
  provider_player_id TEXT,
  position TEXT,
  class_year TEXT,
  height_text TEXT,
  size_text TEXT,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  source_json TEXT,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_player_name ON cbb_players(canonical_name);

CREATE TABLE IF NOT EXISTS cbb_player_aliases (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL,
  UNIQUE(player_id,normalized_alias,source)
);
CREATE INDEX IF NOT EXISTS idx_cbb_player_alias_lookup ON cbb_player_aliases(normalized_alias);

CREATE TABLE IF NOT EXISTS cbb_roster_membership (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  season INTEGER,
  effective_from TEXT NOT NULL,
  effective_to TEXT NOT NULL,
  pit_resolvable INTEGER NOT NULL DEFAULT 1,
  membership_basis TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence REAL,
  provenance_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_roster_team_pit ON cbb_roster_membership(team_id,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_cbb_roster_player_pit ON cbb_roster_membership(player_id,effective_from,effective_to);

CREATE TABLE IF NOT EXISTS cbb_state_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  team_id TEXT,
  game_id TEXT,
  season INTEGER,
  state_family TEXT NOT NULL,
  state_value_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  source TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  confidence REAL,
  stale INTEGER NOT NULL DEFAULT 0,
  supersedes_id TEXT,
  pit_eligible INTEGER NOT NULL DEFAULT 1,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_state_entity_time ON cbb_state_events(entity_type,entity_id,effective_at);
CREATE INDEX IF NOT EXISTS idx_cbb_state_team_time ON cbb_state_events(team_id,effective_at);
CREATE INDEX IF NOT EXISTS idx_cbb_state_family_time ON cbb_state_events(state_family,effective_at);

CREATE TABLE IF NOT EXISTS cbb_team_state_snapshots (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  season INTEGER,
  as_of TEXT NOT NULL,
  last_verified_starting_lineup_json TEXT,
  expected_starting_lineup_json TEXT,
  lineup_continuity REAL,
  rotation_hierarchy_json TEXT,
  bench_hierarchy_json TEXT,
  schedule_state_json TEXT,
  availability_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  source TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  confidence REAL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_team_snapshot_time ON cbb_team_state_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS cbb_player_state_snapshots (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  team_id TEXT,
  season INTEGER,
  as_of TEXT NOT NULL,
  starter_role TEXT NOT NULL DEFAULT 'UNKNOWN',
  rotation_rank INTEGER,
  recent_minutes REAL,
  expected_minutes REAL,
  usage_role TEXT,
  availability_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  injury_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  replacement_json TEXT,
  source TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  confidence REAL,
  research_only INTEGER NOT NULL DEFAULT 1,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_player_snapshot_time ON cbb_player_state_snapshots(player_id,as_of DESC);
CREATE INDEX IF NOT EXISTS idx_cbb_player_snapshot_team ON cbb_player_state_snapshots(team_id,as_of DESC);

CREATE TABLE IF NOT EXISTS cbb_schedule_items (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  opponent_team_id TEXT,
  season INTEGER NOT NULL,
  game_date TEXT NOT NULL,
  home_away TEXT NOT NULL,
  rest_days REAL,
  travel_miles REAL,
  fixture_congestion_json TEXT,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  research_only INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbb_schedule_team_date ON cbb_schedule_items(team_id,game_date);

CREATE TABLE IF NOT EXISTS cbb_directory_population_runs (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  source_run_id TEXT NOT NULL,
  source_sha TEXT NOT NULL,
  status TEXT NOT NULL,
  canonical_teams INTEGER NOT NULL DEFAULT 0,
  players INTEGER NOT NULL DEFAULT 0,
  roster_memberships INTEGER NOT NULL DEFAULT 0,
  state_events INTEGER NOT NULL DEFAULT 0,
  team_snapshots INTEGER NOT NULL DEFAULT 0,
  player_snapshots INTEGER NOT NULL DEFAULT 0,
  schedule_items INTEGER NOT NULL DEFAULT 0,
  qa_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cbb_state_overlay_governance (
  state_family TEXT PRIMARY KEY,
  overlay_version TEXT NOT NULL DEFAULT 'FBIS-STATE-OVERLAY-v1',
  mode TEXT NOT NULL DEFAULT 'RESEARCH',
  target_scope TEXT NOT NULL,
  can_influence_projection INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR REPLACE INTO cbb_state_overlay_governance
(state_family,overlay_version,mode,target_scope,can_influence_projection,can_qualify,can_authorize_wager,notes,updated_at)
VALUES
('TEAM_PLAYER_DIRECTORY','FBIS-STATE-OVERLAY-v1','ACTIVE_INFRASTRUCTURE','CONTEXT_ONLY',0,0,0,'Persistent CBB identity/state infrastructure only.',datetime('now')),
('POSSESSION','FBIS-STATE-OVERLAY-v1','RESEARCH','MARGIN:RESEARCH|TOTALS:REJECT|WIN_PROB:KEEP',0,0,0,'PIT freeze policy.',datetime('now')),
('LINEUP','FBIS-STATE-OVERLAY-v1','RESEARCH','MARGIN:RESEARCH|TOTALS:REJECT|WIN_PROB:KEEP',0,0,0,'PIT freeze policy.',datetime('now')),
('SHOT_CLOCK','FBIS-STATE-OVERLAY-v1','RESEARCH','MARGIN:REJECT|TOTALS:REJECT|WIN_PROB:RESEARCH',0,0,0,'PIT freeze policy.',datetime('now')),
('PLAYER_ROTATION','FBIS-STATE-OVERLAY-v1','RESEARCH','MARGIN:RESEARCH|TOTALS:REJECT|WIN_PROB:RESEARCH',0,0,0,'PIT freeze policy.',datetime('now')),
('PLAYER_ROTATION_X_LINEUP','FBIS-STATE-OVERLAY-v1','RESEARCH','MARGIN:KEEP|TOTALS:REJECT|WIN_PROB:KEEP',0,0,0,'PIT freeze policy.',datetime('now')),
('COMBINED','FBIS-STATE-OVERLAY-v1','RESEARCH','MARGIN:KEEP|TOTALS:REJECT|WIN_PROB:KEEP',0,0,0,'PIT freeze policy.',datetime('now'));

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0079_cbb_persistent_directory_phase_a',datetime('now'));
