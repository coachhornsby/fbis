const numberOrNull=v=>v==null||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))?null:Number(v);

export async function loadSoccerPitchApiPlayerContributors(env,{league,teamIds=[],startDate,asOf,limit=40}={}){
 const db=env?.DB;
 const ids=[...new Set(teamIds.map(String).filter(Boolean))].slice(0,8);
 if(!db?.prepare||!league||!ids.length)return{source:'PitchAPI persisted player match observations',players:[],sampleMatches:0,missingReason:'no-verified-pitchapi-team-id',asOf};
 const qs=ids.map(()=>'?').join(',');
 const sql=`SELECT player_id,team_id,MAX(player_name) player_name,
   COUNT(DISTINCT pitch_match_id) match_count,
   SUM(CASE WHEN minutes_played IS NOT NULL THEN minutes_played END) minutes_played,
   SUM(goals) goals,SUM(assists) assists,
   SUM(CASE WHEN raw_json IS NOT NULL THEN xt_total END) xt_total,
   SUM(CASE WHEN raw_json IS NOT NULL THEN vaep_total END) vaep_total,
   SUM(CASE WHEN raw_json IS NOT NULL THEN xag END) xag,
   SUM(CASE WHEN raw_json IS NOT NULL THEN progressive_passes END) progressive_passes,
   MAX(source_observed_at) latest_observed_at,
   MAX(match_date) latest_match
  FROM soccer_pitchapi_player_match
  WHERE league_key=? AND match_date>=? AND match_date<? AND team_id IN (${qs})
  GROUP BY player_id,team_id
  ORDER BY COALESCE(minutes_played,0) DESC,match_count DESC,player_id
  LIMIT ?`;
 const result=await db.prepare(sql).bind(league,startDate,asOf,...ids,Math.max(1,Math.min(50,limit))).all();
 const players=(result?.results||[]).map(r=>({
   id:`soccer:pitchapi:${r.player_id}`,pitchPlayerId:String(r.player_id),pitchTeamId:String(r.team_id),
   name:r.player_name||null,acquiredMatches:numberOrNull(r.match_count),minutes:numberOrNull(r.minutes_played),
   goals:numberOrNull(r.goals),assists:numberOrNull(r.assists),
   expectedThreat:numberOrNull(r.xt_total),vaep:numberOrNull(r.vaep_total),expectedAssistedGoals:numberOrNull(r.xag),
   progressivePasses:numberOrNull(r.progressive_passes),
   latestObservedAt:r.latest_observed_at||null,latestMatch:r.latest_match||null,
 }));
 return {source:'PitchAPI persisted player match observations',players,
   sampleMatches:players.reduce((s,p)=>s+(p.acquiredMatches||0),0),asOf,
   scope:'Acquired match contributions, including past club members; not proof of current roster membership',
   providerIdPolicy:'PitchAPI player IDs are distinct from ESPN roster IDs',
   researchOnly:true,canInfluenceProjection:false};
}
