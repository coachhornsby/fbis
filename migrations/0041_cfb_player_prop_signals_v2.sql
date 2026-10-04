CREATE TABLE IF NOT EXISTS cfb_player_prop_signals_v2 (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL, player_id TEXT, player_name TEXT NOT NULL, market TEXT NOT NULL, side TEXT NOT NULL,
 signal_line REAL NOT NULL, signal_projection REAL NOT NULL, signal_sigma REAL NOT NULL, z_edge REAL NOT NULL,
 confidence_score INTEGER, confidence_stars INTEGER, signal_at TEXT NOT NULL, actual REAL, result TEXT, close_line REAL, line_clv REAL,
 settled_at TEXT, model_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cfb_prop_signals_event ON cfb_player_prop_signals_v2(event_id);
CREATE INDEX IF NOT EXISTS idx_cfb_prop_signals_signal_at ON cfb_player_prop_signals_v2(signal_at);
