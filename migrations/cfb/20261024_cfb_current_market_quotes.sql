-- CFB-owned bounded hot quote read model. Historical ticks remain in market partitions and R2.
-- Rows are source-specific, pregame-only references and never grant wager execution.
CREATE TABLE IF NOT EXISTS cfb_current_market_quotes (
 quote_key TEXT PRIMARY KEY, provider TEXT NOT NULL, game_id TEXT NOT NULL,
 market_family TEXT NOT NULL, side TEXT NOT NULL, line REAL,
 american_odds REAL, decimal_odds REAL, contract_ask REAL,
 source_market_id TEXT, source_outcome_id TEXT, provider_observed_at TEXT,
 captured_at TEXT NOT NULL, price_basis TEXT NOT NULL, period TEXT NOT NULL DEFAULT 'full_game',
 can_authorize_wager INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cfb_market_game ON cfb_current_market_quotes(game_id,market_family,captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_cfb_market_provider_clock ON cfb_current_market_quotes(provider,captured_at DESC);
