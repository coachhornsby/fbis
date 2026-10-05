function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function safe(s,f){try{return JSON.parse(s)}catch{return f}}
export async function onRequestGet(context){
  const db=context.env.DB;if(!db?.prepare)return json({ok:false,error:"d1_unavailable"},503);
  const u=new URL(context.request.url),team=String(u.searchParams.get("team")||"").toUpperCase();
  if(team){
    const p=await db.prepare("SELECT * FROM nhl_team_profiles WHERE team_key=?").bind(team).first();
    if(!p)return json({ok:false,error:"team_not_found",team},404);
    const [players,goalies,nextGames]=await Promise.all([
      db.prepare("SELECT player_id,player_name,position,status,state_source,state_source_timestamp,carried_forward,expected_toi_seconds,expected_pp_toi_seconds,ev_role,pp_unit,role_confidence,shot_rate,point_rate,linemates_json,replacement_json FROM nhl_player_state_profiles WHERE team_key=? ORDER BY expected_toi_seconds DESC").bind(team).all(),
      db.prepare("SELECT * FROM nhl_goalie_state_profiles WHERE team_key=? ORDER BY start_probability DESC").bind(team).all(),
      db.prepare("SELECT * FROM nhl_team_schedule_items WHERE team_key=? AND start_time>=datetime('now') ORDER BY start_time LIMIT 8").bind(team).all()
    ]);
    return json({ok:true,team,asOf:p.as_of,stateConfidence:p.state_confidence,profile:safe(p.profile_json,{}),
      players:(players.results||[]).map(x=>({...x,linemates:safe(x.linemates_json,[]),replacements:safe(x.replacement_json,[])})),
      goalies:goalies.results||[],nextGames:nextGames.results||[]});
  }
  const [summary,lastRun,states]=await Promise.all([
    db.prepare("SELECT COUNT(*) teams,MIN(as_of) oldest_as_of,MAX(as_of) newest_as_of,AVG(state_confidence) avg_confidence FROM nhl_team_profiles").first(),
    db.prepare("SELECT * FROM nhl_profile_runs ORDER BY run_at DESC LIMIT 1").first(),
    db.prepare("SELECT status,COUNT(*) n FROM nhl_player_state_profiles GROUP BY status ORDER BY n DESC").all()
  ]);
  return json({ok:true,summary:summary||{},lastRun:lastRun||null,playerStates:states.results||[]});
}
