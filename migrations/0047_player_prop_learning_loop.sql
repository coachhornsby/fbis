-- Generic player-prop projection -> actual -> calibration loop.
CREATE TABLE IF NOT EXISTS player_prop_cards (
  card_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  sport TEXT NOT NULL,
  book TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  risk REAL,
  to_win REAL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  result TEXT,
  profit REAL,
  captured_at TEXT NOT NULL,
  settled_at TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS player_prop_legs (
  leg_id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  event_id TEXT,
  provider_game_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  matchup TEXT,
  market TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_line REAL NOT NULL,
  fbis_projection REAL,
  fbis_sigma REAL,
  projection_edge REAL,
  model_version TEXT,
  model_source TEXT,
  source_line_id TEXT,
  projection_observed_at TEXT,
  projection_locked_at TEXT,
  role_confidence REAL,
  snap_share REAL,
  prop_gate TEXT,
  calibration_eligibility TEXT NOT NULL DEFAULT 'PENDING',
  live_actual REAL,
  actual REAL,
  projection_error REAL,
  absolute_error REAL,
  squared_error REAL,
  result TEXT NOT NULL DEFAULT 'OPEN',
  hit INTEGER,
  push INTEGER NOT NULL DEFAULT 0,
  closing_line REAL,
  line_clv REAL,
  stat_source TEXT,
  graded_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(card_id) REFERENCES player_prop_cards(card_id)
);

CREATE INDEX IF NOT EXISTS idx_player_prop_legs_open
  ON player_prop_legs(sport, result, event_id);
CREATE INDEX IF NOT EXISTS idx_player_prop_legs_model
  ON player_prop_legs(sport, market, model_version, graded_at);
CREATE INDEX IF NOT EXISTS idx_player_prop_legs_card
  ON player_prop_legs(card_id);

CREATE VIEW IF NOT EXISTS player_prop_calibration AS
SELECT
  sport,
  market,
  side,
  model_version,
  COUNT(*) AS graded,
  SUM(CASE WHEN push=0 THEN 1 ELSE 0 END) AS decisions,
  SUM(CASE WHEN hit=1 THEN 1 ELSE 0 END) AS wins,
  CASE WHEN SUM(CASE WHEN push=0 THEN 1 ELSE 0 END)>0
    THEN 1.0*SUM(CASE WHEN hit=1 THEN 1 ELSE 0 END)/
      SUM(CASE WHEN push=0 THEN 1 ELSE 0 END)
    ELSE NULL END AS hit_rate,
  AVG(projection_error) AS projection_bias,
  AVG(absolute_error) AS mae,
  SQRT(AVG(squared_error)) AS rmse,
  AVG(projection_edge) AS avg_projection_edge,
  AVG(line_clv) AS avg_line_clv
FROM player_prop_legs
WHERE actual IS NOT NULL
  AND calibration_eligibility LIKE 'ELIGIBLE%'
GROUP BY sport, market, side, model_version;

INSERT OR IGNORE INTO player_prop_cards
(card_id,date,sport,book,entry_type,risk,to_win,status,captured_at,notes)
VALUES
('PP-20261004-A','2026-10-04','nfl','PrizePicks','3-Pick Power Play',3,18,'OPEN','2026-10-04T14:26:00-05:00',
 'Odunze O32.5 Rec Yds / Lawrence U33.5 Pass Att / Kupp O23.5 Rec Yds'),
('PP-20261004-B','2026-10-04','nfl','PrizePicks','3-Pick Power Play',5,40,'OPEN','2026-10-04T14:26:00-05:00',
 'Higgins O62.5 Rec Yds / Jennings O26.5 Rec Yds / Cousins U21.5 Comp');

INSERT OR IGNORE INTO player_prop_legs
(leg_id,card_id,sport,event_id,provider_game_id,player_name,team,matchup,market,side,entry_line,
 fbis_projection,fbis_sigma,projection_edge,model_version,model_source,source_line_id,
 projection_observed_at,projection_locked_at,role_confidence,snap_share,prop_gate,
 calibration_eligibility,live_actual,notes)
VALUES
('PP-20261004-A-1','PP-20261004-A','nfl','401872972','185006','Rome Odunze','CHI','NYJ @ CHI','receiving_yards','OVER',32.5,
 52,21.7,19.5,'research-v3.1-calibrated-last5-role-defense','NFLVERSE_LAST5_65_FLOOR_MARKET_CALIBRATED_NGS_DEFENSE_V3_2',
 'fde6e37621d37b4416bba504b5ab838fd8153a38d8a7a0b8bfafabb868350424','2026-10-02T15:05:23.856-04:00',
 '2026-10-02T15:05:23.856-04:00',0.9,0.8,'CLEAR','ELIGIBLE - pregame source line',94,'Live capture showed threshold already cleared; wait for official final.'),
('PP-20261004-A-2','PP-20261004-A','nfl','401872969','185003','Trevor Lawrence','JAC','JAC @ CIN','passing_attempts','UNDER',33.5,
 28.4,5.3,-5.1,'research-v3.1-calibrated-last5-role-defense','NFLVERSE_LAST5_65_FLOOR_MARKET_CALIBRATED_NGS_DEFENSE_V3_2',
 '7623c5022012bf6cfd02c250eabb626afce75a5cf9a5379642eb4c3548c27ff7','2026-10-03T19:15:39.062-04:00',
 '2026-10-03T19:15:39.062-04:00',0.9,1.0,'CLEAR','ELIGIBLE - pregame source line',18,'Live capture showed 18 attempts in Q4; wait for official final.'),
('PP-20261004-A-3','PP-20261004-A','nfl','401872977','185011','Cooper Kupp','SEA','LAC @ SEA','receiving_yards','OVER',23.5,
 37.6,17.3,14.1,'research-v3.1-calibrated-last5-role-defense','NFLVERSE_LAST5_65_FLOOR_MARKET_CALIBRATED_NGS_DEFENSE_V3_2',
 NULL,'2026-10-01T13:59:40.811-04:00','2026-10-01T13:59:40.811-04:00',0.8,0.7,'CLEAR',
 'ELIGIBLE PROJECTION / MANUAL ENTRY LINE',0,'Exact 23.5 line was screenshot-sourced; independent 37.6 projection existed pregame.'),
('PP-20261004-B-1','PP-20261004-B','nfl','401872969','185003','Tee Higgins','CIN','JAC @ CIN','receiving_yards','OVER',62.5,
 83,21.3,20.5,'research-v3.1-calibrated-last5-role-defense','NFLVERSE_LAST5_65_FLOOR_MARKET_CALIBRATED_NGS_DEFENSE_V3_2',
 '976916563d0122721ee70e986ed8d2ff6277ad6a54287d0fc124a60cb10d2460','2026-10-02T23:44:45.926-04:00',
 '2026-10-02T23:44:45.926-04:00',0.9,0.8,'CLEAR','ELIGIBLE - pregame source line',103,'Live capture showed threshold already cleared; wait for official final.'),
('PP-20261004-B-2','PP-20261004-B','nfl','401872975','185010','Jauan Jennings','MIN','MIA @ MIN','receiving_yards','OVER',26.5,
 50.7,18.2,24.2,'research-v3.1-calibrated-last5-role-defense','NFLVERSE_LAST5_65_FLOOR_MARKET_CALIBRATED_NGS_DEFENSE_V3_2',
 '87e4c11bdf8753f995d26a8fac8ac419714246b3cf9f0967572a16e06201619a','2026-10-04T10:00:34.167-04:00',
 '2026-10-04T10:00:34.167-04:00',0.9,0.8,'CLEAR','ELIGIBLE - pregame source line',0,'Pregame at screenshot capture.'),
('PP-20261004-B-3','PP-20261004-B','nfl','401872976','185012','Kirk Cousins','LV','KC @ LV','completions','UNDER',21.5,
 18.9,1.6,-2.6,'research-v3.1-calibrated-last5-role-defense','NFLVERSE_LAST5_65_FLOOR_MARKET_CALIBRATED_NGS_DEFENSE_V3_2',
 'fbac2d4c1de6ff1a202826abb945e2326e32b7375a852497c2b67a559e28488f','2026-10-04T06:16:18.768-04:00',
 '2026-10-04T06:16:18.768-04:00',0.9,1.0,'CLEAR','ELIGIBLE - pregame source line',0,'Pregame at screenshot capture.');

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0047_player_prop_learning_loop', datetime('now'));
