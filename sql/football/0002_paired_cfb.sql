-- CFB: identical SDV/FBIS event identity, pregame frozen champion, latest receipt.
WITH matched AS (
 SELECT h.game_id gameId,h.home_team_id homeTeamId,h.away_team_id awayTeamId,
 h.kickoff kickoff,p.id snapshotId,p.frozen_at frozenAt,
 p.proj_home champHome,p.proj_away champAway,p.model_version baselineVersion,
 ROW_NUMBER() OVER (PARTITION BY h.game_id ORDER BY p.frozen_at DESC,p.id DESC) rn
 FROM football_sdv_verified_games h
 JOIN prediction_snapshots p ON p.game_id=h.game_id AND p.sport='cfb'
  AND p.model_version='CFB-FBIS-v2'
  AND p.frozen_at<h.kickoff
  AND p.proj_home IS NOT NULL AND p.proj_away IS NOT NULL
 WHERE h.sport='cfb' AND h.season=2026 AND h.prospective=0
  AND h.evidence_class='POSTGAME_RECONSTRUCTED'
  AND h.can_authorize_wager=0
)
SELECT gameId,homeTeamId,awayTeamId,kickoff,snapshotId,frozenAt,
 champHome,champAway,baselineVersion FROM matched WHERE rn=1
ORDER BY kickoff,gameId;
