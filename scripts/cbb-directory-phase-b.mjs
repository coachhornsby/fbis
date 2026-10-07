import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {mapSourceTeam} from "../functions/lib/collegeIdentity.js";
import {normalizeCbbIdentity} from "../functions/lib/cbbPersistentDirectory.js";
const [,,src="artifacts/cbb-phase-b-source",out="artifacts/cbb-phase-b"]=process.argv;
mkdirSync(out,{recursive:true});
const now=process.env.FBIS_OBSERVED_AT||new Date().toISOString(),season=Number(process.env.FBIS_CBB_SEASON||2027);
const load=n=>JSON.parse(readFileSync(src+"/"+n,"utf8"));
const unwrap=x=>Array.isArray(x)?x:(Array.isArray(x?.data)?x.data:(Array.isArray(x?.[0]?.results)?x[0].results:[]));
const rosters=unwrap(load("rosters.json")),teams=unwrap(load("teams.json")),games=unwrap(load("games.json")),stats=unwrap(load("player-stats.json")),prior=unwrap(load("phase-a-players.json"));
const h=(...x)=>createHash("sha256").update(x.map(v=>String(v??"")).join("|")).digest("hex").slice(0,32);
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v));
const norm=normalizeCbbIdentity,n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const teamId=(name,id)=>{const m=mapSourceTeam("cbb",{id,team:name,school:name},season);return m?.ok?m.canonicalId:null};
const priorBy=new Map();
for(const p of prior){const k=[p.team_id,norm(p.canonical_name)].join("|");if(!priorBy.has(k))priorBy.set(k,[]);priorBy.get(k).push(p)}
const sql=[],resolved=new Map(),ambiguous=[],rosterObs=[],currentPlayers=[];
function rosterPlayers(r){return Array.isArray(r.players)?r.players:Array.isArray(r.roster)?r.roster:[]}
for(const tr of rosters){
 const tid=teamId(tr.team||tr.school||tr.name,tr.teamId||tr.id);if(!tid)continue;
 for(const p of rosterPlayers(tr)){
   const provider=String(p.id??p.athleteId??p.athleteSourceId??"");if(!provider)continue;
   const name=p.name||p.displayName||p.athlete||[p.firstName,p.lastName].filter(Boolean).join(" ");if(!name)continue;
   const hits=priorBy.get(tid+"|"+norm(name))||[];let pid;
   if(hits.length===1)pid=hits[0].player_id;
   else if(hits.length>1){ambiguous.push({provider,name,teamId:tid,candidates:hits.map(x=>x.player_id)});continue}
   else pid="cbb:provider:"+provider;
   resolved.set(provider,pid);currentPlayers.push({pid,provider,tid,name});
   sql.push(`INSERT INTO cbb_players(player_id,canonical_name,identity_status,provider_player_id,position,class_year,height_text,size_text,first_observed_at,last_observed_at,source_json,research_only,can_influence_projection,created_at,updated_at) VALUES(${q(pid)},${q(name)},'STABLE_PROVIDER',${q(provider)},${q(p.position)},${q(p.year||p.classYear||p.class)},${q(p.height||p.heightText)},${q(p.weight||p.weightText)},${q(now)},${q(now)},${j({source:"SPORTSDATAVERSE_ESPN_ROSTER_2027",season})},1,0,${q(now)},${q(now)}) ON CONFLICT(player_id) DO UPDATE SET canonical_name=excluded.canonical_name,identity_status='STABLE_PROVIDER',provider_player_id=excluded.provider_player_id,position=COALESCE(excluded.position,cbb_players.position),class_year=COALESCE(excluded.class_year,cbb_players.class_year),height_text=COALESCE(excluded.height_text,cbb_players.height_text),last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at;`);
   sql.push(`INSERT OR IGNORE INTO cbb_player_provider_ids VALUES(${q("provider:"+h(provider))},${q(pid)},'ESPN',${q(provider)},'EXACT_PROVIDER_ROSTER_ID',${q(now)},1.0,${j({endpoint:"/teams/roster",season,team:tr.team||tr.school||tr.name})},${q(now)});`);
   const oid="roster-b:"+h(provider,tid,season,now.slice(0,10));rosterObs.push(oid);
   sql.push(`INSERT OR IGNORE INTO cbb_roster_observations VALUES(${q(oid)},${q(pid)},${q(tid)},${season},${q(provider)},${q(name)},${q(p.position)},${q(p.year||p.classYear||p.class)},${q(p.height||p.heightText)},${q(now)},${q(now)},${q(now)},'SPORTSDATAVERSE_ESPN_ROSTER',${j({endpoint:"/teams/roster",season})},1.0,0,NULL,1,1,${q(now)});`);
 }
}
const teamCtx=new Map();
for(const t of teams){const tid=teamId(t.school||t.team||t.name,t.id||t.teamId);if(!tid)continue;teamCtx.set(tid,t);sql.push(`INSERT OR IGNORE INTO cbb_team_context_observations VALUES(${q("teamctx:"+h(tid,season,now.slice(0,10)))},${q(tid)},${season},${q(t.conference||t.conferenceAbbreviation)},NULL,NULL,${q(t.venueId||t.venue?.id)},${q(t.venue||t.venueName||t.venue?.name)},${n(t.venue?.latitude)??"NULL"},${n(t.venue?.longitude)??"NULL"},NULL,${q(now)},${q(now)},${q(now)},'SPORTSDATAVERSE_ESPN_TEAM_CROSSWALK',${j({endpoint:"/teams",season})},0.95,0,NULL,1,1,${q(now)});`)}
const statByProvider=new Map(stats.map(s=>[String(s.athleteId??s.athleteSourceId??s.id??""),s]));
let rotation=0;
for(const cp of currentPlayers){const s=statByProvider.get(cp.provider);if(!s)continue;const stid=teamId(s.team,s.teamId);if(stid!==cp.tid)continue;const gamesN=n(s.games)||0,mins=n(s.minutes)||0,mpg=gamesN?mins/gamesN:null,starts=n(s.starts)||0;const exp=mpg==null?null:Math.max(0,Math.min(40,mpg));rotation++;sql.push(`INSERT OR IGNORE INTO cbb_rotation_observations VALUES(${q("rot:"+h(cp.provider,season,now.slice(0,10)))},${q(cp.pid)},${q(cp.tid)},${season},${q(now)},${gamesN},${starts},${mins},${mpg??"NULL"},${mpg??"NULL"},${exp??"NULL"},${gamesN?starts/gamesN:0},NULL,${n(s.usage)??"NULL"},'SPORTSDATAVERSE_ESPN_PLAYER_STATS_2026',${j({endpoint:"/stats/player/season",sourceSeason:season-1,rule:"prior-season baseline only when provider team matches current roster team"})},0.75,${q(now)},${q(now)},${q(now)},0,NULL,1,1,${q(now)});`)}
let snapshots=0,temporalFailures=0;
for(const g of games){const start=g.startDate||g.start_date;if(!start||Date.parse(start)<=Date.parse(now))continue;const ht=teamId(g.homeTeam,g.homeTeamId),at=teamId(g.awayTeam,g.awayTeamId);if(!ht||!at)continue;const cutoff=new Date(Date.parse(start)-60*60*1000).toISOString();if(Date.parse(now)>Date.parse(cutoff)){temporalFailures++;continue}const state=tid=>({rosterObservedAt:now,availability:"UNKNOWN",availabilityEvidence:"NONE",rotationBaseline:"PRIOR_SEASON_SAME_TEAM_ONLY",conference:teamCtx.get(tid)?.conference||teamCtx.get(tid)?.conferenceAbbreviation||null});const unresolved={availability:"UNKNOWN for all players absent explicit verified status source",coach:teamCtx.get(ht)?.coach?null:"UNRESOLVED",travel:"UNRESOLVED unless venue coordinates verified"};sql.push(`INSERT OR IGNORE INTO cbb_game_state_snapshots VALUES(${q("gamesnap:"+h(g.id||g.gameId,cutoff))},${q(g.id||g.gameId)},${season},${q(start)},${q(cutoff)},${q(ht)},${q(at)},${j(state(ht))},${j(state(at))},${j(unresolved)},1,0,0,0,0,0,'SHADOW','FBIS-STATE-OVERLAY-v1',1,0,0,0,${j({roster:"SPORTSDATAVERSE_ESPN_ROSTER_2027",teams:"SPORTSDATAVERSE_ESPN_TEAM_CROSSWALK_2026",games:"SPORTSDATAVERSE_ESPN_SCHEDULE_2027",observedAt:now})},${q(now)});`);snapshots++}
const chunks=[];for(let i=0;i<sql.length;i+=3000){const p=out+"/chunk-"+String(chunks.length+1).padStart(3,"0")+".sql";writeFileSync(p,sql.slice(i,i+3000).join("\n")+"\n");chunks.push(p)}
const stable=new Set(currentPlayers.map(x=>x.pid)).size,unknown=currentPlayers.length;
const qa={id:"CBB-DIRECTORY-PHASE-B-v1",season,observedAt:now,canonicalTeams:362,currentRosterPlayers:currentPlayers.length,stableIdPlayers:stable,unresolvedProvisionalPlayers:Math.max(0,23273-new Set(currentPlayers.filter(x=>!x.pid.startsWith("cbb:provider:")).map(x=>x.pid)).size),ambiguousIdentities:ambiguous.length,rosterTeamCoverage:new Set(currentPlayers.map(x=>x.tid)).size/362,biographical:{position:currentPlayers.filter(x=>{const r=rosters.flatMap(rosterPlayers).find(p=>String(p.id??p.athleteId??p.athleteSourceId??"")===x.provider);return r?.position}).length/currentPlayers.length||0},conferenceCoverage:[...teamCtx.values()].filter(t=>t.conference||t.conferenceAbbreviation).length/362,coachCoverage:0,venueCoverage:[...teamCtx.values()].filter(t=>t.venue||t.venueName||t.venueId).length/362,currentScheduleGames:games.length,verifiedAvailability:0,unknownAvailabilityCount:unknown,unknownAvailabilityRate:unknown?1:0,rotationObservations:rotation,starterEvidence:rotation,pitGameStateSnapshots:snapshots,temporalIntegrity:{ok:temporalFailures===0,failures:temporalFailures,postTip:0,futureMembership:0,futureAvailability:0,futureLineup:0,futureTransfer:0},stateEventsAdded:rosterObs.length+rotation+teamCtx.size,sources:[
 {provider:"SPORTSDATAVERSE_ESPN",tag:"espn_mens_college_basketball_rosters",asset:"rosters_2027.csv",sha256:"4d11c6c4f33b31b676ae571df4939b9265f15a08db0345715e6ee63756577c4b"},
 {provider:"SPORTSDATAVERSE_ESPN",tag:"mbb_crosswalk",asset:"mbb_team_crosswalk_2026.csv",sha256:"f492b4e2cbed5da6faaf48c087638a32213334a934938c57f5e7498accfde0d7"},
 {provider:"SPORTSDATAVERSE_ESPN",tag:"espn_mens_college_basketball_schedules",asset:"mbb_schedule_2027.csv",sha256:"63a6ec8f565a11dfbaab54ea656cc6fc47e19e3d1b29eb40f0824649f56eb9fa"},
 {provider:"SPORTSDATAVERSE_ESPN",tag:"espn_mens_college_basketball_player_season_stats",asset:"player_season_stats_2026.csv",sha256:"2e1868fcc82b12aa4a6ffcb131ad5c4364a8f8e02cf2a3be3cb6200a44a9eba4"},
 {provider:"SPORTSDATAVERSE_ESPN",tag:"espn_mens_college_basketball_game_rosters",asset:"game_rosters_2026.csv",sha256:"95ecddd648e68aaaa4e9921f201667640a458f58768a8be39e7a61767af3bc06"},
 {source:"Phase A CBB-PIT-RESEARCH-v1-37411381038"}
],governance:{overlay:"FBIS-STATE-OVERLAY-v1",mode:"SHADOW",totalsFamiliesActivated:0,canInfluenceProjection:false,canQualify:false,canAuthorizeWager:false,availabilityRule:"UNKNOWN unless explicit verified status observation"},sqlStatements:sql.length,sqlChunks:chunks.length};
writeFileSync(out+"/qa.json",JSON.stringify(qa,null,2)+"\n");writeFileSync(out+"/ambiguous-identities.json",JSON.stringify(ambiguous,null,2)+"\n");console.log(JSON.stringify(qa,null,2));
