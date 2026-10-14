/** Verified, source-backed tennis event candidates for Polymarket identity linking.
 * A snapshot of an Action market is NOT a verified tennis schedule.
 * No source-local Polymarket identifier is ever treated as canonical.
 */
export async function loadVerifiedTennisCandidates(db,starts=[]){
 if(!db?.prepare)return [];
 const times=(starts||[]).map(x=>Date.parse(x||"")).filter(Number.isFinite);
 if(!times.length)return [];
 const from=new Date(Math.min(...times)-2*3600000).toISOString();
 const until=new Date(Math.max(...times)+2*3600000).toISOString();
 const result=await db.prepare(`
  SELECT m.match_id AS id,m.match_time AS start,m.tour AS tour,
         p1.canonical_name AS away_name,p2.canonical_name AS home_name
  FROM tennis_official_matches m
  JOIN tennis_players p1 ON m.player1_id=p1.fbis_player_id
  JOIN tennis_players p2 ON m.player2_id=p2.fbis_player_id
  WHERE m.source IN ('ATP_OFFICIAL','WTA_OFFICIAL')
    AND m.match_time BETWEEN ?1 AND ?2
    AND m.player1_id IS NOT NULL AND m.player2_id IS NOT NULL
    AND m.player1_id<>m.player2_id
    AND lower(m.tour)=lower(p1.tour) AND lower(m.tour)=lower(p2.tour)
  ORDER BY m.match_time,m.match_id
 `).bind(from,until).all();
 return (result?.results||[]).filter(x=>x.id&&x.start&&x.away_name&&x.home_name);
}
