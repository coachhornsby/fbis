import { loadMlbPersistentState } from "../lib/mlbPersistentProfiles.js";

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
    const [teams,players,pitchers,hitters,schedule,snapshots,refresh,active,transitioned]=await Promise.all([
      first(db,"SELECT COUNT(*) AS n, MIN(as_of) AS min_as_of, MAX(as_of) AS max_as_of FROM mlb_team_profiles"),
      first(db,"SELECT COUNT(*) AS n, MAX(as_of) AS max_as_of FROM mlb_player_state_profiles"),
      first(db,"SELECT COUNT(*) AS n, SUM(CASE WHEN statcast_profile_json IS NOT NULL AND statcast_profile_json<>'null' THEN 1 ELSE 0 END) AS statcast, MAX(as_of) AS max_as_of FROM mlb_pitcher_profiles"),
      first(db,"SELECT COUNT(*) AS n, SUM(CASE WHEN statcast_profile_json IS NOT NULL AND statcast_profile_json<>'null' THEN 1 ELSE 0 END) AS statcast, MAX(as_of) AS max_as_of FROM mlb_hitter_profiles"),
      first(db,"SELECT COUNT(*) AS n, MIN(start_time) AS min_start, MAX(start_time) AS max_start FROM mlb_team_schedule_items"),
      first(db,"SELECT COUNT(*) AS n, MAX(as_of) AS latest FROM mlb_team_profile_snapshots"),
      first(db,"SELECT COUNT(*) AS shards, SUM(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END) AS success, SUM(error_count) AS errors, SUM(source_calls) AS source_calls, MAX(as_of) AS latest FROM mlb_profile_refresh_state"),
      first(db,"SELECT COUNT(*) AS n FROM mlb_player_state_profiles WHERE roster_status='ACTIVE'"),
      first(db,"SELECT COUNT(*) AS n FROM mlb_player_state_profiles WHERE roster_status='NOT_ON_40_MAN'"),
    ]);
    return json({
      ok:true,
      version:"mlb-state-v2",
      teams:Number(teams?.n||0),
      teamAsOf:{oldest:teams?.min_as_of||null,newest:teams?.max_as_of||null},
      players:Number(players?.n||0),
      activePlayers:Number(active?.n||0),
      transitionedOff40Man:Number(transitioned?.n||0),
      pitchers:Number(pitchers?.n||0),
      pitcherStatcast:Number(pitchers?.statcast||0),
      hitters:Number(hitters?.n||0),
      hitterStatcast:Number(hitters?.statcast||0),
      scheduleRows:Number(schedule?.n||0),
      snapshots:Number(snapshots?.n||0),
      latestSnapshotAt:snapshots?.latest||null,
      refresh:{
        shards:Number(refresh?.shards||0),
        successfulShards:Number(refresh?.success||0),
        errors:Number(refresh?.errors||0),
        sourceCalls:Number(refresh?.source_calls||0),
        latestAsOf:refresh?.latest||null,
      },
      runtimePolicy:{
        customerBoardReads:"D1_BATCHED",
        liveSavantFanout:false,
        livePostseasonFanout:false,
        scheduledCollectors:true,
      },
    });
  }

  const teamId=url.searchParams.get("teamId");
  if(!teamId)return json({ok:false,error:"teamId-required-or-use-summary=1"},400);
  const fakeGame={id:"profile-read",home:{mlbId:Number(teamId)},away:{mlbId:Number(teamId)},homeSp:{},awaySp:{},bpp:{batterMatchups:[]}};
  const result=await loadMlbPersistentState([fakeGame],context.env,{maxAgeHours:9999});
  const state=result.byGameId?.["profile-read"]||null;
  if(!state?.homeTeam)return json({ok:false,error:"team-not-found"},404);
  return json({ok:true,teamId:String(teamId),asOf:state.asOf,ageHours:state.ageHours,team:state.homeTeam});
}
