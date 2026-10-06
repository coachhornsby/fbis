-- Backfill audit coverage for executed wagers that predate/escaped audit writes.
-- Does not alter wager facts, result, profit, or settlement evidence.
INSERT INTO executed_bet_audit (bet_id, action, detail, created_at)
SELECT b.id,
       'historical-audit-backfill',
       'backfilled missing executed-bet audit coverage',
       datetime('now')
FROM executed_bets b
WHERE NOT EXISTS (
  SELECT 1 FROM executed_bet_audit a WHERE a.bet_id = b.id
);

INSERT OR IGNORE INTO schema_migrations(id,applied_at)
VALUES('0087_executed_bet_audit_backfill',datetime('now'));
