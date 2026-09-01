CREATE TABLE IF NOT EXISTS strategy_settlement_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL,
  prior_result TEXT,
  prior_profit REAL,
  corrected_result TEXT NOT NULL,
  corrected_profit REAL,
  reason TEXT NOT NULL,
  evidence TEXT NOT NULL,
  corrected_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_settlement_correction_ticket
  ON strategy_settlement_corrections(ticket_id, prior_result, corrected_result);

INSERT OR IGNORE INTO strategy_settlement_corrections
  (ticket_id, prior_result, prior_profit, corrected_result, corrected_profit, reason, evidence, corrected_at)
SELECT id, result, profit, 'WON', (100.0 / 106.0),
  'Invalid MLB full-game ML push corrected from frozen final',
  'prediction_snapshots game_id=822771 actual_away=13 actual_home=2', datetime('now')
FROM strategy_tickets WHERE id='mlb:2026-08-27:822771:ML:AWAY' AND result='PUSH';

INSERT OR IGNORE INTO strategy_settlement_corrections
  (ticket_id, prior_result, prior_profit, corrected_result, corrected_profit, reason, evidence, corrected_at)
SELECT id, result, profit, 'WON', (100.0 / 102.0),
  'Invalid MLB full-game ML push corrected from frozen final',
  'prediction_snapshots game_id=823179 actual_home=6 actual_away=1', datetime('now')
FROM strategy_tickets WHERE id='mlb:2026-08-27:823179:ML:HOME' AND result='PUSH';

INSERT OR IGNORE INTO strategy_settlement_corrections
  (ticket_id, prior_result, prior_profit, corrected_result, corrected_profit, reason, evidence, corrected_at)
SELECT id, result, profit, 'LOST', -1.0,
  'Invalid MLB full-game ML push corrected from frozen final',
  'prediction_snapshots game_id=822694 actual_away=1 actual_home=7', datetime('now')
FROM strategy_tickets WHERE id='mlb:2026-08-27:822694:ML:AWAY' AND result='PUSH';

INSERT OR IGNORE INTO strategy_settlement_corrections
  (ticket_id, prior_result, prior_profit, corrected_result, corrected_profit, reason, evidence, corrected_at)
SELECT id, result, profit, 'WON', NULL,
  'Invalid MLB full-game ML push corrected from frozen final; execution price unavailable',
  'prediction_snapshots game_id=823581 actual_away=8 actual_home=2', datetime('now')
FROM strategy_tickets WHERE id='mlb:2026-08-27:823581:ML:AWAY' AND result='PUSH';

UPDATE strategy_tickets SET result='WON', profit=(100.0 / 106.0), graded_at=datetime('now')
WHERE id='mlb:2026-08-27:822771:ML:AWAY' AND result='PUSH';
UPDATE strategy_tickets SET result='WON', profit=(100.0 / 102.0), graded_at=datetime('now')
WHERE id='mlb:2026-08-27:823179:ML:HOME' AND result='PUSH';
UPDATE strategy_tickets SET result='LOST', profit=-1.0, graded_at=datetime('now')
WHERE id='mlb:2026-08-27:822694:ML:AWAY' AND result='PUSH';
UPDATE strategy_tickets SET result='WON', profit=NULL, graded_at=datetime('now')
WHERE id='mlb:2026-08-27:823581:ML:AWAY' AND result='PUSH';
