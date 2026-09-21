-- Preserve the factual outcome used to settle each executed wager.
ALTER TABLE executed_bets ADD COLUMN final_away_score REAL;
ALTER TABLE executed_bets ADD COLUMN final_home_score REAL;
ALTER TABLE executed_bets ADD COLUMN f5_away_score REAL;
ALTER TABLE executed_bets ADD COLUMN f5_home_score REAL;
ALTER TABLE executed_bets ADD COLUMN settlement_source TEXT;
ALTER TABLE executed_bets ADD COLUMN settlement_evidence_json TEXT;

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0029_executed_bet_settlement_evidence', datetime('now'));
