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
