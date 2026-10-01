-- Shared paid-Apify ledger + curated PrizePicks observations.
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
