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

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0020_action_apify_shadow', datetime('now'));
