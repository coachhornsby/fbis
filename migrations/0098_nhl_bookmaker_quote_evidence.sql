-- Prospective NHL market observations from scheduled, authenticated provider captures.
-- Source quote time is nullable and must never be replaced by the collector receipt.
-- This table is observational only: no bet, promotion or economic authority.
CREATE TABLE IF NOT EXISTS nhl_bookmaker_quote_evidence (
  id TEXT PRIMARY KEY,
  source_event_id TEXT NOT NULL,
  game_start TEXT,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  market_family TEXT NOT NULL CHECK (market_family IN ('moneyline')),
  selection TEXT NOT NULL CHECK (selection IN ('HOME','AWAY')),
  bookmaker TEXT NOT NULL,
  provider TEXT NOT NULL,
  american_price INTEGER NOT NULL,
  source_observed_at TEXT,
  captured_at TEXT NOT NULL,
  capture_class TEXT NOT NULL CHECK (capture_class IN ('PREGAME_UNVERIFIED_SOURCE_TIME','PREGAME_SOURCE_TIME_VERIFIED','POST_START','UNKNOWN_START')),
  can_qualify INTEGER NOT NULL DEFAULT 0 CHECK (can_qualify=0),
  can_authorize_wager INTEGER NOT NULL DEFAULT 0 CHECK (can_authorize_wager=0)
);
CREATE INDEX IF NOT EXISTS idx_nhl_quote_evidence_game_time
ON nhl_bookmaker_quote_evidence (source_event_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_nhl_quote_evidence_book_time
ON nhl_bookmaker_quote_evidence (bookmaker, captured_at);
