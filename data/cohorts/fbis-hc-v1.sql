-- FBIS-HC-v1 operator-corrected 2026-08-26 seed (N=7). INSERT OR IGNORE; stable ids.
INSERT INTO strategies (id, name, version, rules_json, notes, created_at)
VALUES (
  'FBIS-HC-v1',
  'High-conviction qualified',
  1,
  '{"qualified":true,"lean":false,"minEv":0.08,"tag":"CONVICTION","marketComplete":true}',
  'Conjunction: qualified ticket AND EV ≥ 8% (CONVICTION). Not a lean. Complete two-way Pinnacle market. Champion weights stay frozen. N=7 is a sample, not proof the filter works.',
  '2026-08-27T05:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  version = excluded.version,
  rules_json = excluded.rules_json,
  notes = excluded.notes;

INSERT OR IGNORE INTO strategy_tickets (
  id, strategy_id, role, sport, date, game_id, matchup, market, side, pick, line,
  ev, edge, tag, pin_vig, pin_price, model_version, checkpoint, data_quality,
  result, profit, clv, traits_json, created_at, graded_at
) VALUES ('mlb:2026-08-26:824234:ML:AWAY', 'FBIS-HC-v1', 'seed', 'mlb', '2026-08-26', '824234', 'TB @ DET', 'ML', 'AWAY', 'Tampa Bay ML', NULL, NULL, NULL, 'CONVICTION', NULL, NULL, NULL, NULL, NULL, 'WON', NULL, NULL, '{"namedPosition":"Tampa Bay ML","reconstruction":"user-provided","actualHome":0,"actualAway":3,"homeAway":"AWAY","overUnder":null,"favorite":null}', '2026-08-27T05:00:00.000Z', '2026-08-27T05:00:00.000Z');
UPDATE strategy_tickets
SET result = 'WON', profit = NULL, clv = NULL, graded_at = '2026-08-27T05:00:00.000Z'
WHERE id = 'mlb:2026-08-26:824234:ML:AWAY' AND (result IS NULL OR result = 'OPEN');

INSERT OR IGNORE INTO strategy_tickets (
  id, strategy_id, role, sport, date, game_id, matchup, market, side, pick, line,
  ev, edge, tag, pin_vig, pin_price, model_version, checkpoint, data_quality,
  result, profit, clv, traits_json, created_at, graded_at
) VALUES ('mlb:2026-08-26:822692:TOTAL:OVER', 'FBIS-HC-v1', 'seed', 'mlb', '2026-08-26', '822692', 'COL @ WSH', 'TOTAL', 'OVER', 'Col/Wash over 9.5', 9.5, NULL, NULL, 'CONVICTION', NULL, NULL, NULL, NULL, NULL, 'WON', NULL, NULL, '{"namedPosition":"Col/Wash over 9.5","reconstruction":"user-provided","actualHome":1,"actualAway":13,"homeAway":null,"overUnder":"OVER","favorite":null}', '2026-08-27T05:00:00.000Z', '2026-08-27T05:00:00.000Z');
UPDATE strategy_tickets
SET result = 'WON', profit = NULL, clv = NULL, graded_at = '2026-08-27T05:00:00.000Z'
WHERE id = 'mlb:2026-08-26:822692:TOTAL:OVER' AND (result IS NULL OR result = 'OPEN');

INSERT OR IGNORE INTO strategy_tickets (
  id, strategy_id, role, sport, date, game_id, matchup, market, side, pick, line,
  ev, edge, tag, pin_vig, pin_price, model_version, checkpoint, data_quality,
  result, profit, clv, traits_json, created_at, graded_at
) VALUES ('mlb:2026-08-26:823506:TOTAL:OVER', 'FBIS-HC-v1', 'seed', 'mlb', '2026-08-26', '823506', 'HOU @ NYY', 'TOTAL', 'OVER', 'Hou/NYY over 9', 9, NULL, NULL, 'CONVICTION', NULL, NULL, NULL, NULL, NULL, 'WON', NULL, NULL, '{"namedPosition":"Hou/NYY over 9","reconstruction":"user-provided","actualHome":9,"actualAway":3,"homeAway":null,"overUnder":"OVER","favorite":null}', '2026-08-27T05:00:00.000Z', '2026-08-27T05:00:00.000Z');
UPDATE strategy_tickets
SET result = 'WON', profit = NULL, clv = NULL, graded_at = '2026-08-27T05:00:00.000Z'
WHERE id = 'mlb:2026-08-26:823506:TOTAL:OVER' AND (result IS NULL OR result = 'OPEN');

INSERT OR IGNORE INTO strategy_tickets (
  id, strategy_id, role, sport, date, game_id, matchup, market, side, pick, line,
  ev, edge, tag, pin_vig, pin_price, model_version, checkpoint, data_quality,
  result, profit, clv, traits_json, created_at, graded_at
) VALUES ('mlb:2026-08-26:823584:TOTAL:OVER', 'FBIS-HC-v1', 'seed', 'mlb', '2026-08-26', '823584', 'MIL @ NYM', 'TOTAL', 'OVER', 'MIL/NYM over 8.5', 8.5, NULL, NULL, 'CONVICTION', NULL, NULL, NULL, NULL, NULL, 'WON', NULL, NULL, '{"namedPosition":"MIL/NYM over 8.5","reconstruction":"user-provided","actualHome":1,"actualAway":8,"homeAway":null,"overUnder":"OVER","favorite":null}', '2026-08-27T05:00:00.000Z', '2026-08-27T05:00:00.000Z');
UPDATE strategy_tickets
SET result = 'WON', profit = NULL, clv = NULL, graded_at = '2026-08-27T05:00:00.000Z'
WHERE id = 'mlb:2026-08-26:823584:TOTAL:OVER' AND (result IS NULL OR result = 'OPEN');

INSERT OR IGNORE INTO strategy_tickets (
  id, strategy_id, role, sport, date, game_id, matchup, market, side, pick, line,
  ev, edge, tag, pin_vig, pin_price, model_version, checkpoint, data_quality,
  result, profit, clv, traits_json, created_at, graded_at
) VALUES ('mlb:2026-08-26:824878:TOTAL:OVER', 'FBIS-HC-v1', 'seed', 'mlb', '2026-08-26', '824878', 'LAD @ ATL', 'TOTAL', 'OVER', 'LAD/ATL over 8.5', 8.5, NULL, NULL, 'CONVICTION', NULL, NULL, NULL, NULL, NULL, 'WON', NULL, NULL, '{"namedPosition":"LAD/ATL over 8.5","reconstruction":"user-provided","actualHome":6,"actualAway":5,"homeAway":null,"overUnder":"OVER","favorite":null}', '2026-08-27T05:00:00.000Z', '2026-08-27T05:00:00.000Z');
UPDATE strategy_tickets
SET result = 'WON', profit = NULL, clv = NULL, graded_at = '2026-08-27T05:00:00.000Z'
WHERE id = 'mlb:2026-08-26:824878:TOTAL:OVER' AND (result IS NULL OR result = 'OPEN');

INSERT OR IGNORE INTO strategy_tickets (
  id, strategy_id, role, sport, date, game_id, matchup, market, side, pick, line,
  ev, edge, tag, pin_vig, pin_price, model_version, checkpoint, data_quality,
  result, profit, clv, traits_json, created_at, graded_at
) VALUES ('mlb:2026-08-26:823015:TOTAL:OVER', 'FBIS-HC-v1', 'seed', 'mlb', '2026-08-26', '823015', 'BAL @ STL', 'TOTAL', 'OVER', 'BAL/STL over 8.5', 8.5, NULL, NULL, 'CONVICTION', NULL, NULL, NULL, NULL, NULL, 'WON', NULL, NULL, '{"namedPosition":"BAL/STL over 8.5","reconstruction":"user-provided","actualHome":7,"actualAway":8,"homeAway":null,"overUnder":"OVER","favorite":null}', '2026-08-27T05:00:00.000Z', '2026-08-27T05:00:00.000Z');
UPDATE strategy_tickets
SET result = 'WON', profit = NULL, clv = NULL, graded_at = '2026-08-27T05:00:00.000Z'
WHERE id = 'mlb:2026-08-26:823015:TOTAL:OVER' AND (result IS NULL OR result = 'OPEN');

INSERT OR IGNORE INTO strategy_tickets (
  id, strategy_id, role, sport, date, game_id, matchup, market, side, pick, line,
  ev, edge, tag, pin_vig, pin_price, model_version, checkpoint, data_quality,
  result, profit, clv, traits_json, created_at, graded_at
) VALUES ('mlb:2026-08-26:824963:SPREAD:HOME', 'FBIS-HC-v1', 'seed', 'mlb', '2026-08-26', '824963', 'MIN @ ATH', 'SPREAD', 'HOME', 'OAK +1.5', 1.5, NULL, NULL, 'CONVICTION', NULL, NULL, NULL, NULL, NULL, 'WON', NULL, NULL, '{"namedPosition":"OAK +1.5","reconstruction":"user-provided","actualHome":7,"actualAway":4,"homeAway":"HOME","overUnder":null,"favorite":null}', '2026-08-27T05:00:00.000Z', '2026-08-27T05:00:00.000Z');
UPDATE strategy_tickets
SET result = 'WON', profit = NULL, clv = NULL, graded_at = '2026-08-27T05:00:00.000Z'
WHERE id = 'mlb:2026-08-26:824963:SPREAD:HOME' AND (result IS NULL OR result = 'OPEN');
