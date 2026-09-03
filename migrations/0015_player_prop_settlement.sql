-- Preserve the operator-entered statistic used to grade sportsbook player props.
ALTER TABLE executed_bets ADD COLUMN prop_actual REAL;
ALTER TABLE executed_bets ADD COLUMN prop_stat_source TEXT;
ALTER TABLE executed_bets ADD COLUMN player_name TEXT;
ALTER TABLE executed_bets ADD COLUMN prop_type TEXT;

UPDATE executed_bets
SET player_name = selected_team,
    prop_type = CASE
      WHEN LOWER(COALESCE(raw_text, '')) LIKE '%strikeout%' THEN 'PITCHER_STRIKEOUTS'
      ELSE 'PLAYER_PROP'
    END
WHERE market = 'PLAYER_PROP';

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0015_player_prop_settlement', datetime('now'));
