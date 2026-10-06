import { authorizeSoccerWorker, unauthorizedBody } from "../lib/soccerWorkerAuth.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function safeJson(v,fallback=[]){try{const x=JSON.parse(String(v||""));return x??fallback;}catch{return fallback;}}
function days(a,b){const x=Date.parse(String(a||"").slice(0,10)+"T12:00:00Z"),y=Date.parse(String(b||"").slice(0,10)+"T12:00:00Z");return Number.isFinite(x)&&Number.isFinite(y)?Math.max(0,(y-x)/86400000):null;}
function starterIds(row){return new Set((safeJson(row?.starters_json,[])||[]).map(x=>String(x?.player_id||x?.id||"")).filter(Boolean));}
function jaccard(a,b){if(!a.size&&!b.size)return null;let n=0;for(const x of a)if(b.has(x))n++;return n/(a.size+b.size-n||1);}
function mean(xs){const a=xs.filter(x=>Number.isFinite(x));return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}
function mode(xs){const m=new Map();for(const x of xs.filter(Boolean))m.set(x,(m.get(x)||0)+1);return [...m.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;}
function now(){return new Date().toISOString();}

export async function onRequestPost(context){
  const auth=authorizeSoccerWorker(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  const db=context.env?.DB;if(!db?.prepare)return json({ok:false,error:"d1-unbound"},503);
  const asOf=now();
  let req={};try{req=await context.request.json();}catch{}
  const requested=String(req.teamId||"");
  const team=requested
    ? await db.prepare(`WITH raw AS (
        SELECT home_team_id team_id,home_team_name team_name,league_key FROM soccer_pitchapi_match_features
        UNION ALL
        SELECT away_team_id,away_team_name,league_key FROM soccer_pitchapi_match_features
      ) SELECT team_id,MAX(team_name) team_name,MAX(league_key) league_key FROM raw WHERE team_id=? GROUP BY team_id`).bind(requested).first()
    : await db.prepare(`WITH raw AS (
        SELECT home_team_id team_id,home_team_name team_name,league_key FROM soccer_pitchapi_match_features
        UNION ALL
        SELECT away_team_id,away_team_name,league_key FROM soccer_pitchapi_match_features
      ), teams AS (
        SELECT team_id,MAX(team_name) team_name,MAX(league_key) league_key FROM raw GROUP BY team_id
      )
      SELECT t.team_id,t.team_name,t.league_key,s.updated_at
      FROM teams t
      LEFT JOIN soccer_team_state s ON s.team_id=t.team_id
      JOIN soccer_competition_coverage c ON c.heritage_key=t.league_key
      WHERE c.discovery_status='MATCHED' AND c.model_eligible=1
      ORDER BY CASE WHEN s.updated_at IS NULL THEN 0 ELSE 1 END,s.updated_at,t.team_id LIMIT 1`).first();
  if(!team?.team_id)return json({ok:true,empty:true});

  const teamId=String(team.team_id);
  const recent=(await db.prepare(`SELECT pitch_match_id,league_key,match_date,start_time,
      CASE WHEN home_team_id=? THEN home_score ELSE away_score END team_score,
      CASE WHEN home_team_id=? THEN away_score ELSE home_score END opp_score
    FROM soccer_pitchapi_match_features
    WHERE status='finished' AND (home_team_id=? OR away_team_id=?)
    ORDER BY match_date DESC,pitch_match_id DESC LIMIT 20`).bind(teamId,teamId,teamId,teamId).all()).results||[];
  const lastDate=recent[0]?.match_date||null;
  const matches14=recent.filter(x=>days(x.match_date,asOf)<=14).length;
  const matches28=recent.filter(x=>days(x.match_date,asOf)<=28).length;
  const competitionCount28=new Set(recent.filter(x=>days(x.match_date,asOf)<=28).map(x=>x.league_key).filter(Boolean)).size;
  const restDays=recent.length>=2?days(recent[1].match_date,recent[0].match_date):(lastDate?days(lastDate,asOf):null);

  const lineups=(await db.prepare(`SELECT * FROM soccer_pitchapi_lineup_observations
    WHERE team_id=? AND observed_at<=?
    ORDER BY observed_at DESC LIMIT 5`).bind(teamId,asOf).all()).results||[];
  const latest=lineups[0]||null;
  const sets=lineups.map(starterIds);
  const continuity=sets.length>=2?mean(sets.slice(0,-1).map((s,i)=>jaccard(s,sets[i+1]))):null;
  const rotation=continuity==null?null:1-continuity;
  const primaryFormation=mode(lineups.map(x=>x.formation));
  const manager=latest?.coach_name||lineups.find(x=>x.coach_name)?.coach_name||null;

  const keeper=await db.prepare(`SELECT player_id,player_name,match_date
    FROM soccer_pitchapi_player_match
    WHERE team_id=? AND (saves IS NOT NULL OR claims IS NOT NULL OR sweeper_actions IS NOT NULL)
    ORDER BY match_date DESC LIMIT 1`).bind(teamId).first();

  const latestStarters=starterIds(latest);
  const latestSubs=new Set((safeJson(latest?.subs_json,[])||[]).map(x=>String(x?.player_id||x?.id||"")).filter(Boolean));
  const lineupNames=new Map();
  for(const l of lineups){
    for(const p of [...safeJson(l?.starters_json,[]),...safeJson(l?.subs_json,[])])if(p?.player_id)lineupNames.set(String(p.player_id),p.name||null);
  }
  const playerAgg=(await db.prepare(`SELECT player_id,MAX(player_name) player_name,MAX(match_date) last_match_date,
      COUNT(DISTINCT pitch_match_id) appearances_28,
      SUM(CASE WHEN match_date>=date('now','-7 day') THEN COALESCE(minutes_played,0) ELSE 0 END) minutes_7,
      SUM(CASE WHEN match_date>=date('now','-14 day') THEN COALESCE(minutes_played,0) ELSE 0 END) minutes_14,
      SUM(CASE WHEN match_date>=date('now','-28 day') THEN COALESCE(minutes_played,0) ELSE 0 END) minutes_28
    FROM soccer_pitchapi_player_match
    WHERE team_id=? AND match_date>=date('now','-28 day')
    GROUP BY player_id`).bind(teamId).all()).results||[];
  const byId=new Map(playerAgg.map(x=>[String(x.player_id),x]));
  for(const id of [...latestStarters,...latestSubs])if(!byId.has(id))byId.set(id,{player_id:id,player_name:lineupNames.get(id)||null,last_match_date:null,appearances_28:0,minutes_7:0,minutes_14:0,minutes_28:0});

  const availability=(await db.prepare(`SELECT a.* FROM soccer_availability_observations a
    JOIN (SELECT player_id,MAX(observed_at) observed_at FROM soccer_availability_observations WHERE team_id=? GROUP BY player_id) x
      ON x.player_id=a.player_id AND x.observed_at=a.observed_at
    WHERE a.team_id=?`).bind(teamId,teamId).all()).results||[];
  const avMap=new Map(availability.map(x=>[String(x.player_id),x]));

  const startCounts=new Map();
  for(const l of lineups)for(const id of starterIds(l))startCounts.set(id,(startCounts.get(id)||0)+1);

  const created=asOf;
  for(const [id,p] of byId){
    const av=avMap.get(id);
    const xi=latestStarters.has(id)?"STARTER_LAST_XI":latestSubs.has(id)?"BENCH_LAST_XI":"RECENT_SQUAD";
    const mins28=Number(p.minutes_28||0),load=mins28/Math.max(1,28/7*90);
    await db.prepare(`INSERT INTO soccer_player_state(
      player_id,team_id,player_name,role_state,availability_status,availability_reason,availability_source,availability_observed_at,
      expected_xi_state,last_match_date,last_start_date,appearances_28,starts_5,minutes_7,minutes_14,minutes_28,load_index_28,
      replacement_rank,goalkeeper_evidence,state_as_of,research_only,can_influence_projection,source_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,1,0,?,?,?)
    ON CONFLICT(player_id) DO UPDATE SET
      team_id=excluded.team_id,player_name=COALESCE(excluded.player_name,soccer_player_state.player_name),
      role_state=excluded.role_state,availability_status=excluded.availability_status,availability_reason=excluded.availability_reason,
      availability_source=excluded.availability_source,availability_observed_at=excluded.availability_observed_at,
      expected_xi_state=excluded.expected_xi_state,last_match_date=excluded.last_match_date,last_start_date=excluded.last_start_date,
      appearances_28=excluded.appearances_28,starts_5=excluded.starts_5,minutes_7=excluded.minutes_7,minutes_14=excluded.minutes_14,
      minutes_28=excluded.minutes_28,load_index_28=excluded.load_index_28,goalkeeper_evidence=excluded.goalkeeper_evidence,
      state_as_of=excluded.state_as_of,research_only=1,can_influence_projection=0,source_json=excluded.source_json,updated_at=excluded.updated_at`).bind(
        id,teamId,p.player_name||lineupNames.get(id)||null,xi,av?.status||"UNKNOWN",av?.reason||null,av?.source||null,av?.observed_at||null,
        xi,p.last_match_date||null,latestStarters.has(id)?latest?.kickoff_time||null:null,Number(p.appearances_28||0),Number(startCounts.get(id)||0),
        Number(p.minutes_7||0),Number(p.minutes_14||0),mins28,load,null,String(keeper?.player_id||"")===id?1:0,asOf,
        JSON.stringify({lineupEvidence:lineups.length,availabilityEvidence:Boolean(av),provider:"PitchAPI+FBIS"}),created,asOf
      ).run();
    const prow=await db.prepare("SELECT * FROM soccer_player_state WHERE player_id=?").bind(id).first();
    if(prow)await db.prepare(`INSERT OR REPLACE INTO soccer_player_state_snapshots(
      id,player_id,team_id,target_match_id,snapshot_as_of,data_cutoff,state_json,research_only,can_influence_projection,created_at
    ) VALUES(?,?,?,?,?,?,?,1,0,?)`).bind(id+":"+asOf,id,teamId,null,asOf,asOf,JSON.stringify(prow),created).run();
  }

  await db.prepare(`INSERT INTO soccer_team_state(
    team_id,team_name,league_key,manager_name,primary_formation,goalkeeper_player_id,goalkeeper_name,
    latest_lineup_match_id,latest_lineup_observed_at,latest_lineup_confirmed,lineup_continuity_5,rotation_index_5,
    matches_14,matches_28,competition_count_28,rest_days,travel_km_14,travel_source,state_as_of,research_only,
    can_influence_projection,source_json,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?,?)
  ON CONFLICT(team_id) DO UPDATE SET
    team_name=excluded.team_name,league_key=excluded.league_key,manager_name=excluded.manager_name,primary_formation=excluded.primary_formation,
    goalkeeper_player_id=excluded.goalkeeper_player_id,goalkeeper_name=excluded.goalkeeper_name,latest_lineup_match_id=excluded.latest_lineup_match_id,
    latest_lineup_observed_at=excluded.latest_lineup_observed_at,latest_lineup_confirmed=excluded.latest_lineup_confirmed,
    lineup_continuity_5=excluded.lineup_continuity_5,rotation_index_5=excluded.rotation_index_5,matches_14=excluded.matches_14,
    matches_28=excluded.matches_28,competition_count_28=excluded.competition_count_28,rest_days=excluded.rest_days,
    state_as_of=excluded.state_as_of,research_only=1,can_influence_projection=0,source_json=excluded.source_json,updated_at=excluded.updated_at`).bind(
      teamId,team.team_name||null,team.league_key||recent[0]?.league_key||null,manager,primaryFormation,keeper?.player_id||null,keeper?.player_name||null,
      latest?.pitch_match_id||null,latest?.observed_at||null,Number(latest?.confirmed||0),continuity,rotation,matches14,matches28,competitionCount28,restDays,
      null,"VENUE_COORDINATES_NOT_AVAILABLE",asOf,JSON.stringify({recentMatches:recent.length,lineupObservations:lineups.length,playerStates:byId.size,availabilityFeed:"OBSERVATION_TABLE_ONLY"}),created,asOf
    ).run();
  const trow=await db.prepare("SELECT * FROM soccer_team_state WHERE team_id=?").bind(teamId).first();
  if(trow)await db.prepare(`INSERT OR REPLACE INTO soccer_team_state_snapshots(
    id,team_id,league_key,target_match_id,snapshot_as_of,data_cutoff,state_json,research_only,can_influence_projection,created_at
  ) VALUES(?,?,?,?,?,?,?,1,0,?)`).bind(teamId+":"+asOf,teamId,trow.league_key,null,asOf,asOf,JSON.stringify(trow),created).run();

  return json({ok:true,researchOnly:true,canInfluenceProjection:false,teamId,teamName:team.team_name||null,leagueKey:trow?.league_key||null,
    manager,primaryFormation,goalkeeper:keeper?{playerId:keeper.player_id,name:keeper.player_name}:null,
    lineupContinuity5:continuity,rotationIndex5:rotation,matches14,matches28,competitionCount28,restDays,
    lineupObservations:lineups.length,playerStates:byId.size,availabilityObservations:availability.length,stateAsOf:asOf});
}
