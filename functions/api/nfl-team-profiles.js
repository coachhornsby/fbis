import { loadNflTeamProfiles } from "../lib/nflTeamProfiles.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=60","access-control-allow-origin":"*"},
  });
}
async function first(db,sql,...binds){
  try{return await db.prepare(sql).bind(...binds).first();}catch{return null;}
}
export async function onRequestGet(context){
  if(!context.env?.DB?.prepare)return json({ok:false,error:"database-unavailable"},503);
  const db=context.env.DB;
  const url=new URL(context.request.url);
  if(url.searchParams.get("summary")==="1"){
    const [teams,players,schedule,snapshots,runs,health,coachCoverage]=await Promise.all([
      first(db,"SELECT COUNT(*) AS n FROM nfl_team_profiles"),
      first(db,"SELECT COUNT(*) AS n FROM nfl_player_profiles"),
      first(db,"SELECT COUNT(*) AS n FROM nfl_team_schedule_profile"),
      first(db,"SELECT COUNT(*) AS n FROM nfl_team_profile_snapshots"),
      first(db,"SELECT COUNT(*) AS n, SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed, MAX(completed_at) AS latest FROM nfl_profile_sync_runs"),
      db.prepare("SELECT health_state, COUNT(*) AS n FROM nfl_player_profiles GROUP BY health_state ORDER BY n DESC").all().catch(()=>({results:[]})),
      first(db,"SELECT SUM(CASE WHEN head_coach IS NOT NULL AND head_coach<>'' THEN 1 ELSE 0 END) AS head_coaches, SUM(CASE WHEN offensive_coordinator IS NOT NULL AND offensive_coordinator<>'' THEN 1 ELSE 0 END) AS offensive_coordinators, SUM(CASE WHEN defensive_coordinator IS NOT NULL AND defensive_coordinator<>'' THEN 1 ELSE 0 END) AS defensive_coordinators FROM nfl_team_profiles"),
    ]);
    return json({
      ok:true,
      teams:Number(teams?.n||0),
      players:Number(players?.n||0),
      scheduleRows:Number(schedule?.n||0),
      snapshots:Number(snapshots?.n||0),
      syncRuns:Number(runs?.n||0),
      failedSyncRuns:Number(runs?.failed||0),
      latestSyncAt:runs?.latest||null,
      coachCoverage:{
        head:Number(coachCoverage?.head_coaches||0),
        offense:Number(coachCoverage?.offensive_coordinators||0),
        defense:Number(coachCoverage?.defensive_coordinators||0),
      },
      health:Object.fromEntries((health?.results||[]).map(r=>[r.health_state,Number(r.n||0)])),
    });
  }

  const teamRaw=url.searchParams.get("team")||"";
  if(!teamRaw)return json({ok:false,error:"team-required-or-use-summary=1"},400);
  const teams=[...new Set(teamRaw.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean))].slice(0,4);
  const profiles=await loadNflTeamProfiles(db,teams);
  return json({
    ok:true,
    teams:Object.values(profiles.teams||{}).length,
    players:Object.values(profiles.players||{}).reduce((n,x)=>n+x.length,0),
    scheduleRows:Object.values(profiles.schedule||{}).reduce((n,x)=>n+x.length,0),
    profiles,
  });
}
