-- NFL: nflverse game IDs do not equal FBIS IDs. Require same minute and
-- exact nflverse away/home suffix AND pregame frozen NFL-PRO v1.2 receipt.
WITH matched AS (
 SELECT h.game_id gameId,h.home_team_id homeTeamId,h.away_team_id awayTeamId,
 h.kickoff kickoff,p.id snapshotId,p.frozen_at frozenAt,
 p.proj_home champHome,p.proj_away champAway,p.model_version baselineVersion,
 ROW_NUMBER() OVER (PARTITION BY h.game_id ORDER BY p.frozen_at DESC,
   CASE WHEN g.id GLOB '[0-9]*' THEN 0 ELSE 1 END,p.id DESC) rn
 FROM football_sdv_verified_games h
 JOIN games g ON g.sport='nfl'
  AND substr(h.kickoff,1,16)=substr(g.start,1,16)
  AND substr(h.game_id,-length(g.away_abbr)-length(g.home_abbr)-1)
      =g.away_abbr||'_'||g.home_abbr
 JOIN prediction_snapshots p ON p.game_id=g.id AND p.sport='nfl'
  AND p.model_version='v1.2'
  AND p.frozen_at<h.kickoff
  AND p.proj_home IS NOT NULL AND p.proj_away IS NOT NULL
 WHERE h.sport='nfl' AND h.season=2026 AND h.prospective=0
  AND h.evidence_class='POSTGAME_RECONSTRUCTED'
  AND h.can_authorize_wager=0
)
SELECT gameId,homeTeamId,awayTeamId,kickoff,snapshotId,frozenAt,
 champHome,champAway,baselineVersion FROM matched WHERE rn=1
ORDER BY kickoff,gameId;
