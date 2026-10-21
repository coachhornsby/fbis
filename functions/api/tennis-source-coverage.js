// Read-only Tennis source coverage. Counts do not authorize projections or image display.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const SQL={
 fixtures:`SELECT tour, COUNT(*) AS upcoming FROM tennis_official_matches WHERE julianday(match_time)>julianday('now') AND julianday(match_time)<=julianday('now','+72 hours') AND completion_state IN ('SCHEDULED','NOT_STARTED','UPCOMING') GROUP BY tour`,
 portraits:`SELECT p.tour,COUNT(*) AS players,COUNT(NULLIF(TRIM(p.official_headshot_url),'')) AS linked_external,COUNT(a.fbis_player_id) AS approved_assets FROM tennis_players p LEFT JOIN tennis_player_portraits a ON a.fbis_player_id=p.fbis_player_id AND a.approval_status='APPROVED' AND a.public_display_allowed=1 AND a.display_scope='PUBLIC_WEB' AND a.rights_evidence_ref IS NOT NULL GROUP BY p.tour`,
 prizepicks:`SELECT ct_date,state,run_id,rows_returned,started_at,completed_at FROM prizepicks_daily_acquisitions ORDER BY ct_date DESC LIMIT 1`,
 externalFixtures:`SELECT tour,COUNT(*) AS upcoming,COUNT(DISTINCT CASE WHEN source='ESPN_PUBLIC' THEN fixture_id END) AS independently_observed FROM tennis_external_fixtures WHERE julianday(match_time)>julianday('now') AND julianday(match_time)<=julianday('now','+72 hours') AND status='SCHEDULED' AND julianday(fetched_at)>=julianday('now','-24 hours') GROUP BY tour`,
 profileCoverage:`SELECT m.tour,COUNT(*) AS upcoming_official, SUM(CASE WHEN q1.player_key IS NOT NULL AND q2.player_key IS NOT NULL THEN 1 ELSE 0 END) AS both_surface_profiles_present FROM tennis_official_matches m JOIN tennis_players p1 ON p1.fbis_player_id=m.player1_id JOIN tennis_players p2 ON p2.fbis_player_id=m.player2_id LEFT JOIN tennis_player_profiles_current q1 ON q1.tour=m.tour AND q1.player_key=lower(trim(p1.canonical_name)) AND q1.surface=m.surface LEFT JOIN tennis_player_profiles_current q2 ON q2.tour=m.tour AND q2.player_key=lower(trim(p2.canonical_name)) AND q2.surface=m.surface WHERE julianday(m.match_time)>julianday('now') AND julianday(m.match_time)<=julianday('now','+72 hours') AND m.completion_state IN ('SCHEDULED','NOT_STARTED','UPCOMING') GROUP BY m.tour`,
 tennisImages:`SELECT COUNT(*) AS tennis_prop_rows,COUNT(NULLIF(TRIM(player_headshot_url),'')) AS image_rows,COUNT(DISTINCT CASE WHEN player_headshot_url IS NOT NULL AND TRIM(player_headshot_url)<>'' THEN LOWER(TRIM(player_name)) END) AS candidate_players FROM prizepicks_prop_lines WHERE lower(sport)='tennis' AND julianday(collected_at)>=julianday('now','-72 hours')`
};
export async function onRequestGet({env}){
 if(!env?.DB?.prepare)return json({ok:false,reason:'DB_REQUIRED'},503);
 try{
  const entries=await Promise.all(Object.entries(SQL).map(async([key,sql])=>[key,(await env.DB.prepare(sql).all()).results||[]]));
  const data=Object.fromEntries(entries);
  return json({ok:true,asOf:new Date().toISOString(),windowHours:72,
   officialFixtures:data.fixtures,externalResearchFixtures:data.externalFixtures,profileCoverage:data.profileCoverage,portraits:data.portraits,
   latestPrizePicksAcquisition:data.prizepicks[0]||null,
   recentPrizePicksTennisImages:data.tennisImages[0]||null,
   policy:{priceSourceIsProjection:false,externalImageIsApprovedAsset:false,sourceCoverageDoesNotAuthorizeWager:true}});
 }catch{return json({ok:false,reason:'SOURCE_COVERAGE_UNAVAILABLE'},503);}
}
