#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import {
  normalizeNbaTeamKey,normalizePlayerName,resolvePersistentPlayerState,deriveScheduleStress,scheduleSummary,
  rotationRole,replacementCandidates
} from "../functions/lib/nbaTeamProfile.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const sourceFile=args.source||"artifacts/nba-team-profile-source.json";
const priorFile=args.prior||"artifacts/nba-player-states-prior.json";
const availabilityFile=args.availability||"artifacts/nba-availability.json";
const lineupFile=args.lineups||"artifacts/nba-lineups.json";
const frozenFile=args.frozen||"artifacts/frozen/nba-canonical.jsonl";
const currentFile=args.current||"artifacts/current/nba-canonical.jsonl";
const impactFile=args.impact||"artifacts/nba-player-impact-live.json";
const out=args.out||"artifacts/nba-team-profiles.json";
const sqlOut=args.sql||"artifacts/nba-team-profiles.sql";
const asOf=args.asOf||new Date().toISOString();
const createdAt=new Date().toISOString();
const hash=s=>crypto.createHash("sha256").update(String(s)).digest("hex");
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>{const n=Number(v);return Number.isFinite(n)?String(n):"NULL"};
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const readJson=p=>{if(!fs.existsSync(p)||!fs.statSync(p).size)return null;try{return JSON.parse(fs.readFileSync(p,"utf8"))}catch{return null}};
const readJsonl=p=>fs.existsSync(p)&&fs.statSync(p).size?fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
function flatten(x){
 if(Array.isArray(x)){if(x.every(r=>Array.isArray(r?.results)))return x.flatMap(r=>r.results||[]);if(x.length===1&&Array.isArray(x[0]?.results))return x[0].results;return x}
 if(Array.isArray(x?.rows))return x.rows;
 if(Array.isArray(x?.results))return x.results;
 if(Array.isArray(x?.result))return x.result.flatMap(r=>r?.results||[]);
 return[];
}
const source=readJson(sourceFile)||{teams:[]},priorRows=flatten(readJson(priorFile)),availability=flatten(readJson(availabilityFile)),lineups=flatten(readJson(lineupFile));
const impactRaw=readJson(impactFile)||{};
const impactRows=flatten(impactRaw);
const impacts=impactRaw?.players
  ? impactRaw
  : {players:Object.fromEntries(impactRows.filter(r=>r.player_id).map(r=>[String(r.player_id),{
      playerId:String(r.player_id),name:r.player_name||null,teamId:String(r.team_id||""),position:r.position||null,
      offense:finite(r.offense_impact),defense:finite(r.defense_impact),net:finite(r.net_impact),
      skill:(()=>{try{return JSON.parse(r.dynamic_skill_json||"{}")}catch{return{}}})()
    }])),roleContexts:{}};
const games=[...new Map([...readJsonl(frozenFile),...readJsonl(currentFile)].map(g=>[String(g.id),g])).values()].sort((a,b)=>Date.parse(a.start||a.date)-Date.parse(b.start||b.date));
const priorById=new Map(priorRows.filter(x=>x.player_id).map(x=>[String(x.player_id),x]));
const priorByName=new Map(priorRows.map(x=>[normalizePlayerName(x.player_name),x]));
const appearances=new Map(),teamGames=new Map();

for(const g of games){
 for(const side of ["home","away"]){
   const teamId=String(g[side+"Id"]||g[side]?.id||"");if(!teamId)continue;
   if(!teamGames.has(teamId))teamGames.set(teamId,[]);
   const score=finite(side==="home"?g.homeScore:g.awayScore),opp=finite(side==="home"?g.awayScore:g.homeScore),poss=finite(g.possessions)||finite(g[side]?.possessions);
   teamGames.get(teamId).push({
     date:g.start||g.date,points:score,oppPoints:opp,possessions:poss,
     offRtg:poss>0&&score!=null?100*score/poss:null,defRtg:poss>0&&opp!=null?100*opp/poss:null,
     efg:finite(g[side]?.efg),tovPct:finite(g[side]?.tovPct),orbPct:finite(g[side]?.orbPct),ftr:finite(g[side]?.ftRate),threeRate:finite(g[side]?.threeRate)
   });
 }
 for(const p of g.players||[]){
   const id=String(p.id||p.name||"");if(!id)continue;
   if(!appearances.has(id))appearances.set(id,[]);
   appearances.get(id).push({...p,date:g.start||g.date,gameId:String(g.id),teamId:String(p.teamId||"")});
 }
}
function playerStats(id){
 const rows=(appearances.get(String(id))||[]).filter(x=>Date.parse(x.date||0)<Date.parse(asOf)).slice(-15);
 const mins=rows.map(x=>finite(x.minutes)).filter(v=>v!=null),starts=rows.map(x=>x.starter?1:0);
 return {
   games:rows.length,expectedMinutes:mean(mins.slice(-8))??mean(mins)??0,
   starterProbability:starts.length?mean(starts.slice(-10)):0,
   lastGame:rows.at(-1)?.date||null,lastMinutes:finite(rows.at(-1)?.minutes)
 };
}
function styleProfile(teamId){
 const rows=(teamGames.get(String(teamId))||[]).filter(x=>Date.parse(x.date||0)<Date.parse(asOf)).slice(-15);
 const avg=k=>mean(rows.map(x=>finite(x[k])).filter(v=>v!=null));
 return {sampleGames:rows.length,pace:avg("possessions"),offRtg:avg("offRtg"),defRtg:avg("defRtg"),efg:avg("efg"),tovPct:avg("tovPct"),orbPct:avg("orbPct"),ftr:avg("ftr"),threeRate:avg("threeRate")};
}
function latestCoverage(teamKey){
 const candidates=availability.filter(()=>false); // coverage is summarized inside impact role contexts; retained for compatibility.
 return candidates[0]||null;
}
const profiles=[],playerProfiles=[],scheduleRows=[],coachRows=[],stateEvents=[];

for(const team of source.teams||[]){
 const teamId=String(team.teamId),teamKey=normalizeNbaTeamKey(team.teamKey);
 const schedule=deriveScheduleStress(team.schedule||[],teamKey),schedSummary=scheduleSummary(team.schedule||[],teamKey,{asOf});
 const roster=(team.roster||[]).map(p=>{
   const id=String(p.id||""),stats=playerStats(id),impact=impacts.players?.[id]||null;
   return {...p,id,expectedMinutes:stats.expectedMinutes,starterProbability:stats.starterProbability,lastGame:stats.lastGame,lastMinutes:stats.lastMinutes,impactNet:finite(impact?.net)};
 });
 const states={};
 for(const p of roster){
   const prior=priorById.get(p.id)||priorByName.get(normalizePlayerName(p.name))||null;
   const state=resolvePersistentPlayerState({
     player:p,priorState:prior,availabilityRows:availability,lineupRows:lineups,gameAppearances:appearances.get(p.id)||[],asOf
   });
   state.expectedMinutes=p.expectedMinutes;
   state.starterProbability=p.starterProbability;
   state.rotationRole=rotationRole(p.expectedMinutes,p.starterProbability);
   state.playerImpactNet=p.impactNet;
   states[p.id]=state;
 }
 for(const p of roster){
   const state=states[p.id];
   const replacements=replacementCandidates(p.id,roster,states,impacts.players||{});
   state.replacements=replacements;
   playerProfiles.push({...state,teamId,teamKey});
   const evid=state.latestEvidence;
   if(evid){
     const eid="nba-state-event:"+hash([p.id,state.source,state.sourceTimestamp,state.status].join("|")).slice(0,32);
     stateEvents.push({id:eid,playerId:p.id,playerName:p.name,teamKey,eventType:state.source,status:state.status,injuryDetail:state.injuryDetail,source:state.source,sourceTimestamp:state.sourceTimestamp,evidenceRank:
       state.source==="CONFIRMED_LINEUP"?100:state.source==="ACTUAL_GAME_APPEARANCE"?95:state.source.includes("NBA_OFFICIAL")?90:20,raw:evid});
   }
 }
 const coaches=team.coaches||[],head=coaches.find(c=>/head/i.test(String(c.role||"")))||coaches[0]||null;
 const activeStates=Object.values(states);
 const availabilitySummary={
   out:activeStates.filter(x=>x.status==="OUT").map(x=>x.playerName),
   doubtful:activeStates.filter(x=>x.status==="DOUBTFUL").map(x=>x.playerName),
   questionable:activeStates.filter(x=>x.status==="QUESTIONABLE").map(x=>x.playerName),
   probable:activeStates.filter(x=>x.status==="PROBABLE").map(x=>x.playerName),
   carried:activeStates.filter(x=>x.carriedForward).map(x=>x.playerName),
   verified:activeStates.filter(x=>x.confidence>=.9).length
 };
 const rotation=roster.map(p=>({
   playerId:p.id,playerName:p.name,position:p.position,expectedMinutes:p.expectedMinutes,starterProbability:p.starterProbability,
   role:states[p.id]?.rotationRole,status:states[p.id]?.status,impactNet:p.impactNet,replacements:states[p.id]?.replacements||[]
 })).sort((a,b)=>(b.expectedMinutes||0)-(a.expectedMinutes||0));
 const style=styleProfile(teamId);
 const profile={
   teamId,teamKey,teamName:team.teamName,season:team.season,asOf,
   coach:{headCoach:head,staff:coaches},
   roster,playerStates:states,rotation,availability:availabilitySummary,style,
   schedule:{summary:schedSummary,games:schedule},
   scheduleWeakSpots:schedSummary.weakSpots,
   travel:{nextGame:schedSummary.nextGame,weakSpots:schedSummary.weakSpots.slice(0,8)},
   governance:{persistentPlayerState:true,calendarDoesNotClearInjury:true,confirmedLineupOverridesCarry:true,coachContextDescriptiveUntilValidated:true,scheduleStressDescriptiveUntilValidated:true}
 };
 const confidence=roster.length?mean(Object.values(states).map(x=>x.confidence)):0;
 profiles.push({...profile,stateConfidence:confidence});
 for(const g of schedule)scheduleRows.push({...g,teamId,teamKey,observedAt:asOf,source:"ESPN_TEAM_SCHEDULE"});
 for(const c of coaches)coachRows.push({teamId,teamKey,...c,observedAt:asOf,source:"ESPN_TEAM_ROSTER"});
}

const sql=[];
for(const p of playerProfiles){
 const id=p.playerId||"name:"+normalizePlayerName(p.playerName),prior=priorById.get(String(p.playerId))||priorByName.get(normalizePlayerName(p.playerName));
 sql.push(`INSERT INTO nba_player_state_profiles (player_id,player_name,team_id,team_key,as_of,status,state_source,state_source_timestamp,injury_detail,injury_type,injury_severity,carried_forward,expected_minutes,rotation_role,starter_probability,player_impact_net,replacement_json,state_confidence,profile_json,created_at,updated_at) VALUES (${q(id)},${q(p.playerName)},${q(p.teamId)},${q(p.teamKey)},${q(asOf)},${q(p.status)},${q(p.source)},${q(p.sourceTimestamp)},${q(p.injuryDetail)},${q(p.injuryType)},${q(p.injurySeverity)},${p.carriedForward?1:0},${num(p.expectedMinutes)},${q(p.rotationRole)},${num(p.starterProbability)},${num(p.playerImpactNet)},${q(JSON.stringify(p.replacements||[]))},${num(p.confidence)},${q(JSON.stringify(p))},COALESCE((SELECT created_at FROM nba_player_state_profiles WHERE player_id=${q(id)}),${q(createdAt)}),${q(createdAt)}) ON CONFLICT(player_id) DO UPDATE SET player_name=excluded.player_name,team_id=excluded.team_id,team_key=excluded.team_key,as_of=excluded.as_of,status=excluded.status,state_source=excluded.state_source,state_source_timestamp=excluded.state_source_timestamp,injury_detail=excluded.injury_detail,injury_type=excluded.injury_type,injury_severity=excluded.injury_severity,carried_forward=excluded.carried_forward,expected_minutes=excluded.expected_minutes,rotation_role=excluded.rotation_role,starter_probability=excluded.starter_probability,player_impact_net=excluded.player_impact_net,replacement_json=excluded.replacement_json,state_confidence=excluded.state_confidence,profile_json=excluded.profile_json,updated_at=excluded.updated_at;`);
}
for(const e of stateEvents)sql.push(`INSERT OR IGNORE INTO nba_player_state_events (id,player_id,player_name,team_key,event_type,status,injury_detail,source,source_timestamp,evidence_rank,raw_json,created_at) VALUES (${q(e.id)},${q(e.playerId)},${q(e.playerName)},${q(e.teamKey)},${q(e.eventType)},${q(e.status)},${q(e.injuryDetail)},${q(e.source)},${q(e.sourceTimestamp)},${Number(e.evidenceRank||0)},${q(JSON.stringify(e.raw||{}))},${q(createdAt)});`);
for(const p of profiles){
 const snapId="nba-team-profile:"+hash([p.teamId,asOf].join("|")).slice(0,32);
 sql.push(`INSERT INTO nba_team_profiles (team_id,team_key,team_name,as_of,season,head_coach_id,head_coach_name,coach_experience_years,roster_json,rotation_json,availability_json,style_json,schedule_json,schedule_weak_spots_json,travel_json,profile_json,state_confidence,created_at,updated_at) VALUES (${q(p.teamId)},${q(p.teamKey)},${q(p.teamName)},${q(asOf)},${Number(p.season)||"NULL"},${q(p.coach?.headCoach?.id)},${q(p.coach?.headCoach?.name)},${num(p.coach?.headCoach?.experienceYears)},${q(JSON.stringify(p.roster))},${q(JSON.stringify(p.rotation))},${q(JSON.stringify(p.availability))},${q(JSON.stringify(p.style))},${q(JSON.stringify(p.schedule))},${q(JSON.stringify(p.scheduleWeakSpots))},${q(JSON.stringify(p.travel))},${q(JSON.stringify(p))},${num(p.stateConfidence)},COALESCE((SELECT created_at FROM nba_team_profiles WHERE team_id=${q(p.teamId)}),${q(createdAt)}),${q(createdAt)}) ON CONFLICT(team_id) DO UPDATE SET team_key=excluded.team_key,team_name=excluded.team_name,as_of=excluded.as_of,season=excluded.season,head_coach_id=excluded.head_coach_id,head_coach_name=excluded.head_coach_name,coach_experience_years=excluded.coach_experience_years,roster_json=excluded.roster_json,rotation_json=excluded.rotation_json,availability_json=excluded.availability_json,style_json=excluded.style_json,schedule_json=excluded.schedule_json,schedule_weak_spots_json=excluded.schedule_weak_spots_json,travel_json=excluded.travel_json,profile_json=excluded.profile_json,state_confidence=excluded.state_confidence,updated_at=excluded.updated_at;`);
 sql.push(`INSERT OR IGNORE INTO nba_team_profile_snapshots (id,team_id,team_key,as_of,season,profile_json,created_at) VALUES (${q(snapId)},${q(p.teamId)},${q(p.teamKey)},${q(asOf)},${Number(p.season)||"NULL"},${q(JSON.stringify(p))},${q(createdAt)});`);
}
for(const s of scheduleRows){
 const id="nba-schedule:"+hash([s.teamId,s.gameId].join("|")).slice(0,32);
 sql.push(`INSERT OR REPLACE INTO nba_team_schedule_items (id,team_id,team_key,game_id,start_time,opponent_key,venue_team_key,home_away,neutral_site,completed,rest_days,back_to_back,three_in_four,four_in_six,travel_miles,time_zones_crossed,altitude_feet,road_trip_game_number,consecutive_road_games,schedule_stress_score,stress_reasons_json,source,observed_at,raw_json,created_at) VALUES (${q(id)},${q(s.teamId)},${q(s.teamKey)},${q(s.gameId)},${q(s.startTime)},${q(s.opponentKey)},${q(s.venueTeamKey)},${q(s.homeAway)},${s.neutralSite?1:0},${s.completed?1:0},${num(s.restDays)},${s.backToBack?1:0},${s.threeInFour?1:0},${s.fourInSix?1:0},${num(s.travelMiles)},${num(s.timeZonesCrossed)},${num(s.altitudeFeet)},${Number(s.roadTripGameNumber||0)},${Number(s.consecutiveRoadGames||0)},${num(s.scheduleStressScore)},${q(JSON.stringify(s.stressReasons||[]))},${q(s.source)},${q(s.observedAt)},${q(JSON.stringify(s))},${q(createdAt)});`);
}
for(const c of coachRows){
 const id="nba-coach:"+hash([c.teamId,c.id||c.name,asOf.slice(0,10)].join("|")).slice(0,32);
 sql.push(`INSERT OR IGNORE INTO nba_team_coach_history (id,team_id,team_key,coach_id,coach_name,role,experience_years,observed_at,source,raw_json,created_at) VALUES (${q(id)},${q(c.teamId)},${q(c.teamKey)},${q(c.id)},${q(c.name)},${q(c.role)},${num(c.experienceYears)},${q(asOf)},${q(c.source)},${q(JSON.stringify(c))},${q(createdAt)});`);
}
const payload={generatedAt:createdAt,asOf,season:source.season,teams:profiles,
 quality:{teams:profiles.length,players:playerProfiles.length,scheduleItems:scheduleRows.length,coaches:coachRows.length,out:playerProfiles.filter(x=>x.status==="OUT").length,carried:playerProfiles.filter(x=>x.carriedForward).length,weakSpots:profiles.reduce((s,x)=>s+x.scheduleWeakSpots.length,0)}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n");fs.writeFileSync(sqlOut,sql.join("\n")+"\n");
console.log(JSON.stringify(payload.quality,null,2));
