#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import {
  normalizeNflTeamKey,normalizePlayerName,resolveNflPersistentPlayerState,
  deriveNflScheduleStress,nflScheduleSummary,inferNflRole,replacementCandidatesNfl,nflEvidenceRank
} from "../functions/lib/nflTeamProfile.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const sourceFile=args.source||"artifacts/nfl-team-profile-source.json";
const priorFile=args.prior||"artifacts/nfl-player-states-prior.json";
const availabilityFile=args.availability||"artifacts/nfl-availability.json";
const featuresFile=args.features||"artifacts/nfl-features-latest.json";
const out=args.out||"artifacts/nfl-team-profiles.json";
const sqlOut=args.sql||"artifacts/nfl-team-profiles.sql";
const asOf=args.asOf||new Date().toISOString(),createdAt=new Date().toISOString();
const hash=s=>crypto.createHash("sha256").update(String(s)).digest("hex");
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>{const n=Number(v);return Number.isFinite(n)?String(n):"NULL"};
const readJson=p=>{if(!fs.existsSync(p)||!fs.statSync(p).size)return null;try{return JSON.parse(fs.readFileSync(p,"utf8"))}catch{return null}};
function flatten(x){
  if(Array.isArray(x)){if(x.every(r=>Array.isArray(r?.results)))return x.flatMap(r=>r.results||[]);if(x.length===1&&Array.isArray(x[0]?.results))return x[0].results;return x}
  if(Array.isArray(x?.rows))return x.rows;if(Array.isArray(x?.results))return x.results;
  if(Array.isArray(x?.result))return x.result.flatMap(r=>r?.results||[]);return[];
}
const source=readJson(sourceFile)||{teams:[]};
const priorRows=flatten(readJson(priorFile)),availability=flatten(readJson(availabilityFile));
const features=readJson(featuresFile)||{byTeam:{},playersByTeam:{},meta:{}};
const priorById=new Map(priorRows.filter(x=>x.player_id).map(x=>[String(x.player_id),x]));
const priorByName=new Map(priorRows.map(x=>[normalizePlayerName(x.player_name),x]));
const availabilityByTeam=new Map();
for(const a of availability){const k=normalizeNflTeamKey(a.team_key);if(!availabilityByTeam.has(k))availabilityByTeam.set(k,[]);availabilityByTeam.get(k).push(a)}
function featurePlayers(teamKey){
  const rows=features.playersByTeam?.[teamKey]||[];
  return new Map(rows.map(p=>[normalizePlayerName(p.name),p]));
}
function coachRole(coaches,re){return coaches.find(c=>re.test(String(c.role||"")))||null}
const profiles=[],playerProfiles=[],stateEvents=[],scheduleRows=[];
for(const team of source.teams||[]){
  const teamId=String(team.teamId),teamKey=normalizeNflTeamKey(team.teamKey);
  const fplayers=featurePlayers(teamKey),teamFeature=features.byTeam?.[teamKey]||null;
  const schedule=deriveNflScheduleStress(team.schedule||[],teamKey),scheduleSummary=nflScheduleSummary(team.schedule||[],teamKey,{asOf});
  const roster=(team.roster||[]).map(p=>{
    const fp=fplayers.get(normalizePlayerName(p.name))||null;
    return {...p,id:String(p.id||""),snapShare:Number.isFinite(Number(fp?.snapShare))?Number(fp.snapShare):null,
      recentGames:Array.isArray(fp?.recentGames)?fp.recentGames.slice(0,8):[],usage:{
        attempts:fp?.attempts??null,carries:fp?.carries??null,targets:fp?.targets??null,receptions:fp?.receptions??null
      }};
  });
  const states={};
  for(const p of roster){
    const prior=priorById.get(p.id)||priorByName.get(normalizePlayerName(p.name))||null;
    const state=resolveNflPersistentPlayerState({
      player:p,priorState:prior,availabilityRows:availabilityByTeam.get(teamKey)||[],asOf
    });
    state.position=p.position||null;state.snapShare=p.snapShare;state.depthRank=p.depthRank??null;
    state.role=inferNflRole(p,prior||{});
    states[p.id||normalizePlayerName(p.name)]=state;
  }
  for(const p of roster){
    const key=p.id||normalizePlayerName(p.name),state=states[key];
    state.replacements=replacementCandidatesNfl(p.id,roster,states);
    playerProfiles.push({...state,teamId,teamKey,playerId:p.id||null});
    if(state.latestEvidence){
      stateEvents.push({
        id:"nfl-state-event:"+hash([p.id||p.name,state.source,state.sourceTimestamp,state.status].join("|")).slice(0,32),
        playerId:p.id||null,playerName:p.name,teamKey,eventType:state.source,status:state.status,
        injuryDetail:state.injuryDetail,source:state.source,sourceTimestamp:state.sourceTimestamp,
        evidenceRank:nflEvidenceRank(state.source,state.status),raw:state.latestEvidence
      });
    }
  }
  const coaches=team.coaches||[],head=coachRole(coaches,/head/i)||coaches[0]||null,oc=coachRole(coaches,/offensive coordinator/i),dc=coachRole(coaches,/defensive coordinator/i);
  const vals=Object.values(states),availabilitySummary={
    out:vals.filter(x=>["OUT","IR","PUP","NFI","SUSPENDED"].includes(x.status)).map(x=>x.playerName),
    doubtful:vals.filter(x=>x.status==="DOUBTFUL").map(x=>x.playerName),
    questionable:vals.filter(x=>x.status==="QUESTIONABLE").map(x=>x.playerName),
    dnpPractice:vals.filter(x=>x.status==="DNP_PRACTICE").map(x=>x.playerName),
    limited:vals.filter(x=>x.status==="LIMITED").map(x=>x.playerName),
    carried:vals.filter(x=>x.carriedForward).map(x=>x.playerName),
    verified:vals.filter(x=>x.confidence>=.9).length
  };
  const style=teamFeature?{...teamFeature,source:"NFLVERSE_FEATURE_SNAPSHOT",asOf:features.meta?.builtAt||features.meta?.asOf||null}:null;
  const profile={
    teamId,teamKey,teamName:team.teamName,season:team.season,asOf,
    coach:{headCoach:head,offensiveCoordinator:oc,defensiveCoordinator:dc,staff:coaches},
    roster,playerStates:states,availability:availabilitySummary,style,
    schedule:{summary:scheduleSummary,games:schedule},scheduleWeakSpots:scheduleSummary.weakSpots,
    travel:{nextGame:scheduleSummary.nextGame,weakSpots:scheduleSummary.weakSpots.slice(0,8)},
    sourceState:team.sourceState,
    governance:{
      persistentPlayerState:true,calendarDoesNotClearInjury:true,officialNflReportAuthoritative:true,
      finalInactiveListFutureOverride:true,gameAppearanceFutureOverride:true,
      coachingDescriptiveUntilValidated:true,scheduleStressDescriptiveUntilValidated:true,marketDataUsed:false
    }
  };
  profile.stateConfidence=vals.length?vals.reduce((s,x)=>s+Number(x.confidence||0),0)/vals.length:0;
  profiles.push(profile);
  for(const g of schedule)scheduleRows.push({...g,teamId,teamKey});
}
const sql=[],scheduleSql=[];
for(const p of playerProfiles){
  const id=p.playerId||"name:"+normalizePlayerName(p.playerName);
  sql.push(`INSERT INTO nfl_player_state_profiles (player_id,player_name,team_id,team_key,position,as_of,status,state_source,state_source_timestamp,injury_detail,injury_type,injury_severity,carried_forward,depth_rank,snap_share,role,replacement_json,state_confidence,profile_json,created_at,updated_at) VALUES (${q(id)},${q(p.playerName)},${q(p.teamId)},${q(p.teamKey)},${q(p.position)},${q(asOf)},${q(p.status)},${q(p.source)},${q(p.sourceTimestamp)},${q(p.injuryDetail)},${q(p.injuryType)},${q(p.injurySeverity)},${p.carriedForward?1:0},${num(p.depthRank)},${num(p.snapShare)},${q(p.role)},${q(JSON.stringify(p.replacements||[]))},${num(p.confidence)},${q(JSON.stringify(p))},COALESCE((SELECT created_at FROM nfl_player_state_profiles WHERE player_id=${q(id)}),${q(createdAt)}),${q(createdAt)}) ON CONFLICT(player_id) DO UPDATE SET player_name=excluded.player_name,team_id=excluded.team_id,team_key=excluded.team_key,position=excluded.position,as_of=excluded.as_of,status=excluded.status,state_source=excluded.state_source,state_source_timestamp=excluded.state_source_timestamp,injury_detail=excluded.injury_detail,injury_type=excluded.injury_type,injury_severity=excluded.injury_severity,carried_forward=excluded.carried_forward,depth_rank=excluded.depth_rank,snap_share=excluded.snap_share,role=excluded.role,replacement_json=excluded.replacement_json,state_confidence=excluded.state_confidence,profile_json=excluded.profile_json,updated_at=excluded.updated_at;`);
}
for(const e of stateEvents)sql.push(`INSERT OR IGNORE INTO nfl_player_state_events (id,player_id,player_name,team_key,event_type,status,injury_detail,source,source_timestamp,evidence_rank,raw_json,created_at) VALUES (${q(e.id)},${q(e.playerId)},${q(e.playerName)},${q(e.teamKey)},${q(e.eventType)},${q(e.status)},${q(e.injuryDetail)},${q(e.source)},${q(e.sourceTimestamp)},${Number(e.evidenceRank||0)},${q(JSON.stringify(e.raw||{}))},${q(createdAt)});`);
for(const p of profiles){
  const compact={teamId:p.teamId,teamKey:p.teamKey,teamName:p.teamName,season:p.season,asOf:p.asOf,coach:p.coach,availability:p.availability,style:p.style,schedule:{summary:p.schedule.summary},scheduleWeakSpots:p.scheduleWeakSpots.slice(0,12),travel:p.travel,stateConfidence:p.stateConfidence,governance:p.governance};
  const snapId="nfl-team-profile:"+hash([p.teamId,asOf].join("|")).slice(0,32);
  sql.push(`INSERT INTO nfl_team_profiles (team_id,team_key,team_name,as_of,season,head_coach_id,head_coach_name,offensive_coordinator_name,defensive_coordinator_name,roster_json,availability_json,coaching_json,style_json,schedule_json,schedule_weak_spots_json,travel_json,profile_json,state_confidence,created_at,updated_at) VALUES (${q(p.teamId)},${q(p.teamKey)},${q(p.teamName)},${q(asOf)},${Number(p.season)||"NULL"},${q(p.coach?.headCoach?.id)},${q(p.coach?.headCoach?.name)},${q(p.coach?.offensiveCoordinator?.name)},${q(p.coach?.defensiveCoordinator?.name)},${q(JSON.stringify(p.roster))},${q(JSON.stringify(p.availability))},${q(JSON.stringify(p.coach))},${q(JSON.stringify(p.style))},${q(JSON.stringify({summary:p.schedule.summary}))},${q(JSON.stringify(compact.scheduleWeakSpots))},${q(JSON.stringify(p.travel))},${q(JSON.stringify(compact))},${num(p.stateConfidence)},COALESCE((SELECT created_at FROM nfl_team_profiles WHERE team_id=${q(p.teamId)}),${q(createdAt)}),${q(createdAt)}) ON CONFLICT(team_id) DO UPDATE SET team_key=excluded.team_key,team_name=excluded.team_name,as_of=excluded.as_of,season=excluded.season,head_coach_id=excluded.head_coach_id,head_coach_name=excluded.head_coach_name,offensive_coordinator_name=excluded.offensive_coordinator_name,defensive_coordinator_name=excluded.defensive_coordinator_name,roster_json=excluded.roster_json,availability_json=excluded.availability_json,coaching_json=excluded.coaching_json,style_json=excluded.style_json,schedule_json=excluded.schedule_json,schedule_weak_spots_json=excluded.schedule_weak_spots_json,travel_json=excluded.travel_json,profile_json=excluded.profile_json,state_confidence=excluded.state_confidence,updated_at=excluded.updated_at;`);
  sql.push(`INSERT OR IGNORE INTO nfl_team_profile_snapshots (id,team_id,team_key,as_of,season,profile_json,created_at) VALUES (${q(snapId)},${q(p.teamId)},${q(p.teamKey)},${q(asOf)},${Number(p.season)||"NULL"},${q(JSON.stringify(compact))},${q(createdAt)});`);
}
for(const s of scheduleRows){
  const id="nfl-schedule:"+hash([s.teamId,s.gameId].join("|")).slice(0,32);
  scheduleSql.push(`INSERT OR REPLACE INTO nfl_team_schedule_items (id,team_id,team_key,game_id,start_time,opponent_key,venue_team_key,venue_name,venue_city,venue_country,home_away,neutral_site,international,completed,rest_days,short_week,extended_rest,travel_miles,time_zones_crossed,altitude_feet,schedule_stress_score,stress_level,stress_reasons_json,raw_json,updated_at) VALUES (${q(id)},${q(s.teamId)},${q(s.teamKey)},${q(s.gameId)},${q(s.startTime)},${q(s.opponentKey)},${q(s.venueTeamKey)},${q(s.venueName)},${q(s.venueCity)},${q(s.venueCountry)},${q(s.homeAway)},${s.neutralSite?1:0},${s.international?1:0},${s.completed?1:0},${num(s.daysRest)},${s.shortWeek?1:0},${s.extendedRest?1:0},${num(s.travelMiles)},${num(s.timeZonesCrossed)},${num(s.altitudeFeet)},${num(s.scheduleStressScore)},${q(s.stressLevel)},${q(JSON.stringify(s.stressReasons||[]))},${q(JSON.stringify(s))},${q(createdAt)});`);
}
const payload={generatedAt:createdAt,asOf,season:source.season,teams:profiles,quality:{
  teams:profiles.length,players:playerProfiles.length,scheduleItems:scheduleRows.length,
  coaches:profiles.reduce((s,x)=>s+(x.coach?.staff?.length||0),0),
  out:playerProfiles.filter(x=>x.status==="OUT").length,carried:playerProfiles.filter(x=>x.carriedForward).length,
  weakSpots:profiles.reduce((s,x)=>s+x.scheduleWeakSpots.length,0),featureTeams:profiles.filter(x=>x.style).length
}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(sqlOut,sql.join("\n")+"\n");
const dir=sqlOut.split("/").slice(0,-1).join("/")||".";
let files=0;for(let i=0;i<scheduleSql.length;i+=160){fs.writeFileSync(dir+"/nfl-team-schedule-"+String(files).padStart(3,"0")+".sql",scheduleSql.slice(i,i+160).join("\n")+"\n");files++}
payload.quality.scheduleSqlFiles=files;fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n");console.log(JSON.stringify(payload.quality,null,2));
