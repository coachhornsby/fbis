-- CBB player-prop prospective learning ledger.
-- Stores first matched independent FBIS projection + PrizePicks line per player/market/event,
-- then attaches latest pre-start line and actual result after settlement.
CREATE TABLE IF NOT EXISTS cbb_prop_learning_signals (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'PRIZEPICKS',
  sport TEXT NOT NULL DEFAULT 'cbb',
  fbis_event_id TEXT,
  game_id TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  opponent TEXT,
  start_time TEXT,
  market TEXT NOT NULL,
  side TEXT NOT NULL,
  signal_line REAL NOT NULL,
  signal_projection REAL NOT NULL,
  signal_sigma REAL,
  signal_edge REAL NOT NULL,
  signal_z REAL,
  data_quality REAL,
  role_confidence REAL,
  projected_minutes REAL,
  model_id TEXT,
  model_version TEXT,
  signal_observed_at TEXT NOT NULL,
  closing_line REAL,
  closing_observed_at TEXT,
  line_clv REAL,
  actual REAL,
  result TEXT NOT NULL DEFAULT 'OPEN',
  graded_at TEXT,
  payload_json TEXT,
  UNIQUE(fbis_event_id, player_name, market)
);

CREATE INDEX IF NOT EXISTS idx_cbb_prop_learning_start
  ON cbb_prop_learning_signals(start_time, result);
CREATE INDEX IF NOT EXISTS idx_cbb_prop_learning_market
  ON cbb_prop_learning_signals(market, signal_z);
CREATE INDEX IF NOT EXISTS idx_cbb_prop_learning_player
  ON cbb_prop_learning_signals(player_name, market, signal_observed_at);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0040_cbb_prop_learning', datetime('now'));
