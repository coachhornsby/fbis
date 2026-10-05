import { loadNhlPersistentProfiles } from "../lib/nhlPersistentProfiles.js";
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=60","access-control-allow-origin":"*"}});}
async function first(db,sql,...binds){try{return await db.prepare(sql).bind(...binds).first();}catch{return null;}}
export async function onRequestGet(context){
 if(!context.env?.DB?.prepare)return json({ok:false,error:"database-unavailable"},503);
 const db=context.env.DB,url=new URL(context.request.url);
 if(url.searchParams.get("summary")==="1"){
  const [teams,players,goalies,schedule,snapshots,runs,deployment,linemates,tracking,coach]=await Promise.all([
   first(db,"SELECT COUNT(*) n FROM nhl_team_profiles"),
   first(db,"SELECT COUNT(*) n FROM nhl_player_profiles"),
   first(db,"SELECT COUNT(*) n FROM nhl_goalie_profiles"),
   first(db,"SELECT COUNT(*) n FROM nhl_team_schedule_profile"),
   first(db,"SELECT COUNT(*) n FROM nhl_team_profile_snapshots"),
   first(db,"SELECT COUNT(*) n,SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) failed,MAX(completed_at) latest FROM nhl_profile_sync_runs"),
   first(db,"SELECT COUNT(*) n FROM nhl_deployment_observations"),
   first(db,"SELECT COUNT(*) n FROM nhl_linemate_profiles"),
   first(db,"SELECT COUNT(*) n FROM nhl_player_tracking_profiles WHERE available=1"),
   first(db,"SELECT SUM(CASE WHEN json_extract(coach_json,'$.headCoach') IS NOT NULL THEN 1 ELSE 0 END) n FROM nhl_team_profiles")
  ]);
  return json({ok:true,teams:Number(teams?.n||0),players:Number(players?.n||0),goalies:Number(goalies?.n||0),scheduleRows:Number(schedule?.n||0),
   snapshots:Number(snapshots?.n||0),syncRuns:Number(runs?.n||0),failedSyncRuns:Number(runs?.failed||0),latestSyncAt:runs?.latest||null,
   deploymentRows:Number(deployment?.n||0),linemateRows:Number(linemates?.n||0),trackingProfiles:Number(tracking?.n||0),coachProfiles:Number(coach?.n||0)});
 }
 const raw=String(url.searchParams.get("team")||"").trim();if(!raw)return json({ok:false,error:"team-required-or-use-summary=1"},400);
 const teams=[...new Set(raw.split(",").map(x=>x.trim().toUpperCase()).filter(Boolean))].slice(0,6);
 const profiles=await loadNhlPersistentProfiles(db,teams);
 return json({ok:true,requested:teams,profiles});
}
