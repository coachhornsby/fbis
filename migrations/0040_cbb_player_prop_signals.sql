-- 0040_cbb_player_prop_signals.sql
-- Prospective research ledger for independent CBB player-prop signals.
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

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0040_cbb_player_prop_signals', datetime('now'));
