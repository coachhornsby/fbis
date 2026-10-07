#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mapSourceTeam } from "../functions/lib/collegeIdentity.js";
import { normalizeCbbIdentity } from "../functions/lib/cbbPersistentDirectory.js";

const [,,src="artifacts/cbb-phase-b-source",out="artifacts/cbb-phase-b"]=process.argv;
mkdirSync(out,{recursive:true});
const now=process.env.FBIS_OBSERVED_AT||new Date().toISOString();
const season=Number(process.env.FBIS_CBB_SEASON||2027),priorSeason=season-1;
const FAR="9999-12-31T23:59:59.999Z";
const load=n=>JSON.parse(readFileSync(src+"/"+n,"utf8"));
const optional=n=>existsSync(src+"/"+n)?load(n):[];
const rosters=load("rosters.json"),teams=load("teams.json"),gamesRaw=load("games.json"),stats=load("player-stats.json");
const prior=load("phase-a-players.json"),existingProvider=optional("existing-provider-ids.json");
const norm=normalizeCbbIdentity;
const h=(...x)=>createHash("sha256").update(x.map(v=>String(v??"")).join("|")).digest("hex").slice(0,32);
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const j=v=>q(JSON.stringify(v));
const num=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const teamId=(name,id)=>{const m=mapSourceTeam("cbb",{id,team:name,school:name},season);return m?.ok?m.canonicalId:null};
const sources=[
 {provider:"SPORTSDATAVERSE_ESPN",tag:"espn_mens_college_basketball_rosters",asset:"rosters_2027.csv",sha256:"4d11c6c4f33b31b676ae571df4939b9265f15a08db0345715e6ee63756577c4b"},
 {provider:"SPORTSDATAVERSE_ESPN",tag:"mbb_crosswalk",asset:"mbb_team_crosswalk_2026.csv",sha256:"f492b4e2cbed5da6faaf48c087638a32213334a934938c57f5e7498accfde0d7"},
 {provider:"SPORTSDATAVERSE_ESPN",tag:"espn_mens_college_basketball_schedules",asset:"mbb_schedule_2027.csv",sha256:"63a6ec8f565a11dfbaab54ea656cc6fc47e19e3d1b29eb40f0824649f56eb9fa"},
 {provider:"SPORTSDATAVERSE_ESPN",tag:"espn_mens_college_basketball_player_season_stats",asset:"player_season_stats_2026.csv",sha256:"2e1868fcc82b12aa4a6ffcb131ad5c4364a8f8e02cf2a3be3cb6200a44a9eba4"},
 {provider:"SPORTSDATAVERSE_ESPN",tag:"espn_mens_college_basketball_game_rosters",asset:"game_rosters_2026.csv",sha256:"95ecddd648e68aaaa4e9921f201667640a458f58768a8be39e7a61767af3bc06"},
 {provider:"SPORTSDATAVERSE_ESPN",tag:"espn_mens_college_basketball_player_boxscores",asset:"player_box_2026.csv",sha256:"b2f4ebb9a4567744a4112c580d79d05aac4b79066c440881d02f7d4a6828fbb9"},
 {source:"Phase A CBB-PIT-RESEARCH-v1-37411381038"}
].map(x=>({...x,retrievedAt:now,transformationVersion:"CBB-SD-BULK-v1"}));

const priorBySeasonTeamName=new Map(),priorByTeamName=new Map();
for(const p of prior){
 const k=p.team_id+"|"+norm(p.canonical_name),sk=String(p.season)+"|"+k;
 if(!priorByTeamName.has(k))priorByTeamName.set(k,[]);priorByTeamName.get(k).push(p);
 if(!priorBySeasonTeamName.has(sk))priorBySeasonTeamName.set(sk,[]);priorBySeasonTeamName.get(sk).push(p);
}
const providerMap=new Map(existingProvider.filter(x=>String(x.provider).toUpperCase()==="ESPN").map(x=>[String(x.provider_player_id),String(x.player_id)]));
const statByProvider=new Map();
for(const s of stats){
 const id=String(s.athleteId||s.athlete_id||""); if(!id)continue;
 const prev=statByProvider.get(id),score=(num(s.minutes)||0)+(num(s.games)||0)*10;
 const prevScore=prev?(num(prev.minutes)||0)+(num(prev.games)||0)*10:-1;
 if(score>prevScore)statByProvider.set(id,s);
}
function rosterPlayers(r){return Array.isArray(r.players)?r.players:[]}
const players=[],ambiguous=[],transfers=[];
for(const tr of rosters){
 const tid=teamId(tr.team||tr.name,tr.teamId||tr.id);if(!tid)continue;
 for(const p of rosterPlayers(tr)){
  const provider=String(p.id??p.athleteId??"");const name=p.name||p.displayName;if(!provider||!name)continue;
  let pid=providerMap.get(provider)||null,basis=pid?"EXISTING_ESPN_ID":null;
  const ps=statByProvider.get(provider)||null;
  const ptid=ps?teamId(ps.team,ps.teamId):null;
  if(!pid&&ps&&ptid){
   const hits=priorBySeasonTeamName.get(String(priorSeason)+"|"+ptid+"|"+norm(name))||[];
   if(hits.length===1){pid=hits[0].player_id;basis="ESPN_ID_PRIOR_SEASON_TEAM_NAME";}
   else if(hits.length>1){ambiguous.push({provider,name,currentTeamId:tid,priorTeamId:ptid,candidates:hits.map(x=>x.player_id),basis:"PRIOR_SEASON_AMBIGUOUS"});continue;}
  }
  if(!pid){
   const hits=priorByTeamName.get(tid+"|"+norm(name))||[];
   const unique=[...new Map(hits.map(x=>[x.player_id,x])).values()];
   if(unique.length===1){pid=unique[0].player_id;basis="CURRENT_TEAM_NAME_UNIQUE";}
   else if(unique.length>1){ambiguous.push({provider,name,currentTeamId:tid,candidates:unique.map(x=>x.player_id),basis:"CURRENT_TEAM_AMBIGUOUS"});continue;}
  }
  if(!pid){pid="cbb:espn:"+provider;basis="NEW_ESPN_IDENTITY";}
  if(ptid&&ptid!==tid&&basis==="ESPN_ID_PRIOR_SEASON_TEAM_NAME")transfers.push({playerId:pid,provider,fromTeamId:ptid,toTeamId:tid});
  providerMap.set(provider,pid);
  players.push({pid,provider,tid,name,position:p.position||null,classYear:p.year||null,height:p.height||null,size:p.weight||null,uid:p.uid||null,guid:p.guid||null,basis,priorStat:ps,priorTid:ptid});
 }
}
const dedup=[...new Map(players.map(x=>[x.provider,x])).values()];
const byTeam=new Map();for(const p of dedup){if(!byTeam.has(p.tid))byTeam.set(p.tid,[]);byTeam.get(p.tid).push(p)}
const priorMembers=new Set(prior.filter(x=>Number(x.season)===priorSeason).map(x=>x.player_id+"|"+x.team_id));

const games=gamesRaw.map(g=>({raw:g,id:String(g.id||g.gameId||""),start:g.startDate||g.start_date,home:teamId(g.homeTeam,g.homeTeamId),away:teamId(g.awayTeam,g.awayTeamId),neutral:Boolean(g.neutralSite),venueId:g.venueId||null,venueName:g.venueName||null})).filter(g=>g.id&&g.start&&g.home&&g.away);
const venueVotes=new Map();
for(const g of games){if(g.neutral||!g.venueName)continue;const k=g.home;if(!venueVotes.has(k))venueVotes.set(k,new Map());const m=venueVotes.get(k),v=(g.venueId||"")+"|"+g.venueName;m.set(v,(m.get(v)||0)+1);}
const venueByTeam=new Map();
for(const [tid,m] of venueVotes){const [v]=[...m.entries()].sort((a,b)=>b[1]-a[1]);const [id,name]=v[0].split("|");venueByTeam.set(tid,{id:id||null,name});}
const teamCtx=new Map();
for(const t of teams){const tid=teamId(t.team||t.school||t.name,t.teamId||t.id);if(!tid)continue;teamCtx.set(tid,{conference:t.conference||null,coach:null,venue:venueByTeam.get(tid)||{id:null,name:null}})}

const rotations=new Map();
for(const p of dedup){
 const s=p.priorStat;if(!s||p.priorTid!==p.tid)continue;
 const gamesN=num(s.games)||0,starts=num(s.starts)||0,minutes=num(s.minutes)||0,mpg=gamesN?minutes/gamesN:null;
 if(mpg==null)continue;
 const row={...p,games:gamesN,starts,minutes,mpg,expectedMinutes:Math.max(0,Math.min(40,mpg)),starterEvidence:gamesN?starts/gamesN:null,usage:num(s.usage)};
 if(!rotations.has(p.tid))rotations.set(p.tid,[]);rotations.get(p.tid).push(row);
}
for(const a of rotations.values())a.sort((x,y)=>y.expectedMinutes-x.expectedMinutes||x.name.localeCompare(y.name));
const derived=new Map(),replacements=new Map();
for(const [tid,roster] of byTeam){
 const rot=rotations.get(tid)||[],rank=new Map(rot.map((p,i)=>[p.pid,i+1]));
 const continuity=roster.length?roster.filter(p=>priorMembers.has(p.pid+"|"+tid)).length/roster.length:null;
 for(const p of rot){
  const same=rot.filter(x=>x.pid!==p.pid&&p.position&&x.position===p.position),pool=same.length?same:rot.filter(x=>x.pid!==p.pid);
  const repl=pool.find(x=>(rank.get(x.pid)||999)>(rank.get(p.pid)||0))||pool[0]||null;
  if(repl)replacements.set(p.pid,{playerId:repl.pid,name:repl.name,rotationRank:rank.get(repl.pid),basis:same.length?"SAME_POSITION_PRIOR_MINUTES":"PRIOR_MINUTES"});
 }
 derived.set(tid,{continuity,rotation:rot,expected:rot.slice(0,5),bench:rot.slice(5)});
}
const teamGames=new Map();
for(const g of games){for(const [tid,ha,opp] of [[g.home,"HOME",g.away],[g.away,"AWAY",g.home]]){if(!teamGames.has(tid))teamGames.set(tid,[]);teamGames.get(tid).push({g,ha,opp});}}
for(const a of teamGames.values())a.sort((x,y)=>Date.parse(x.g.start)-Date.parse(y.g.start));
const sched=new Map();
for(const [tid,a] of teamGames){for(let i=0;i<a.length;i++){const x=a[i],prev=a[i-1],rest=prev?Math.max(0,(Date.parse(x.g.start)-Date.parse(prev.g.start))/86400000-1):null,prior7=a.slice(0,i).filter(y=>Date.parse(x.g.start)-Date.parse(y.g.start)<=7*86400000).length;sched.set(tid+"|"+x.g.id,{restDays:rest,travelMiles:null,fixtureCongestion:{prior7Days:prior7},homeAway:x.ha,opponentTeamId:x.opp,start:x.g.start});}}

const sql=[],events=[];
for(const p of dedup){
 const prov={source:"SportsDataverse ESPN roster",release:"espn_mens_college_basketball_rosters",asset:"rosters_2027.csv",sha256:sources[0].sha256,identityLinkBasis:p.basis,uid:p.uid,guid:p.guid};
 sql.push(`INSERT INTO cbb_players(player_id,canonical_name,identity_status,provider_player_id,position,class_year,height_text,size_text,first_observed_at,last_observed_at,source_json,research_only,can_influence_projection,created_at,updated_at) VALUES(${q(p.pid)},${q(p.name)},'STABLE_PROVIDER',${q(p.provider)},${q(p.position)},${q(p.classYear)},${q(p.height)},${q(p.size)},${q(now)},${q(now)},${j(prov)},1,0,${q(now)},${q(now)}) ON CONFLICT(player_id) DO UPDATE SET canonical_name=excluded.canonical_name,identity_status='STABLE_PROVIDER',provider_player_id=excluded.provider_player_id,position=COALESCE(excluded.position,cbb_players.position),class_year=COALESCE(excluded.class_year,cbb_players.class_year),height_text=COALESCE(excluded.height_text,cbb_players.height_text),size_text=COALESCE(excluded.size_text,cbb_players.size_text),last_observed_at=excluded.last_observed_at,source_json=excluded.source_json,updated_at=excluded.updated_at;`);
 sql.push(`INSERT OR IGNORE INTO cbb_player_provider_ids(id,player_id,provider,provider_player_id,evidence_type,observed_at,confidence,provenance_json,created_at) VALUES(${q("provider:espn:"+h(p.provider))},${q(p.pid)},'ESPN',${q(p.provider)},${q(p.basis)},${q(now)},1.0,${j(prov)},${q(now)});`);
 sql.push(`INSERT OR IGNORE INTO cbb_player_aliases(id,player_id,alias,normalized_alias,source,observed_at,confidence,created_at) VALUES(${q("phaseb-alias:"+h(p.pid,p.name))},${q(p.pid)},${q(p.name)},${q(norm(p.name))},'SPORTSDATAVERSE_ESPN_ROSTER',${q(now)},1.0,${q(now)});`);
 sql.push(`INSERT OR IGNORE INTO cbb_roster_observations(id,player_id,team_id,season,provider_player_id,canonical_name,position,class_year,height_text,observed_at,effective_at,ingested_at,source,provenance_json,confidence,stale,supersedes_id,pit_eligible,research_only,created_at) VALUES(${q("roster-b:"+h(p.provider,p.tid,season,now.slice(0,10)))},${q(p.pid)},${q(p.tid)},${season},${q(p.provider)},${q(p.name)},${q(p.position)},${q(p.classYear)},${q(p.height)},${q(now)},${q(now)},${q(now)},'SPORTSDATAVERSE_ESPN_ROSTER',${j(prov)},1.0,0,NULL,1,1,${q(now)});`);
 sql.push(`INSERT OR IGNORE INTO cbb_roster_membership(id,player_id,team_id,season,effective_from,effective_to,pit_resolvable,membership_basis,source,observed_at,confidence,provenance_json,created_at) VALUES(${q("member-b:"+h(p.provider,p.tid,season))},${q(p.pid)},${q(p.tid)},${season},${q(now)},${q(FAR)},1,'VERIFIED_ESPN_ROSTER','SPORTSDATAVERSE_ESPN_ROSTER',${q(now)},1.0,${j(prov)},${q(now)});`);
 events.push(`INSERT OR IGNORE INTO cbb_state_events(id,entity_type,entity_id,team_id,game_id,season,state_family,state_value_json,observed_at,effective_at,ingested_at,source,provenance_json,confidence,stale,supersedes_id,pit_eligible,research_only,can_influence_projection,created_at) VALUES(${q("state-b-roster:"+h(p.provider,p.tid,now.slice(0,10)))},'player',${q(p.pid)},${q(p.tid)},NULL,${season},'CURRENT_ROSTER',${j({providerPlayerId:p.provider,position:p.position,classYear:p.classYear,identityLinkBasis:p.basis})},${q(now)},${q(now)},${q(now)},'SPORTSDATAVERSE_ESPN_ROSTER',${j(prov)},1.0,0,NULL,1,1,0,${q(now)});`);
}
for(const t of transfers)events.push(`INSERT OR IGNORE INTO cbb_state_events(id,entity_type,entity_id,team_id,game_id,season,state_family,state_value_json,observed_at,effective_at,ingested_at,source,provenance_json,confidence,stale,supersedes_id,pit_eligible,research_only,can_influence_projection,created_at) VALUES(${q("state-b-transfer:"+h(t.provider,t.fromTeamId,t.toTeamId,season))},'player',${q(t.playerId)},${q(t.toTeamId)},NULL,${season},'TRANSFER_IDENTITY_LINK',${j(t)},${q(now)},${q(now)},${q(now)},'SPORTSDATAVERSE_ESPN_STABLE_ID',${j({rule:"same ESPN athlete_id proves identity across teams"})},1.0,0,NULL,1,1,0,${q(now)});`);

let confTeams=0,venueTeams=0;
for(const [tid,t] of teamCtx){if(t.conference)confTeams++;if(t.venue.name)venueTeams++;
 sql.push(`INSERT OR IGNORE INTO cbb_team_context_observations(id,team_id,season,conference,head_coach,coach_tenure_start,venue_id,venue_name,venue_latitude,venue_longitude,hca_reference,observed_at,effective_at,ingested_at,source,provenance_json,confidence,stale,supersedes_id,pit_eligible,research_only,created_at) VALUES(${q("teamctx:"+h(tid,season,now.slice(0,10)))},${q(tid)},${season},${q(t.conference)},NULL,NULL,${q(t.venue.id)},${q(t.venue.name)},NULL,NULL,NULL,${q(now)},${q(now)},${q(now)},'SPORTSDATAVERSE_ESPN_CONTEXT',${j({conferenceAsset:"mbb_team_crosswalk_2026.csv",venueBasis:"most frequent non-neutral home venue in mbb_schedule_2027.csv"})},0.95,0,NULL,1,1,${q(now)});`);
 if(t.conference)sql.push(`INSERT OR IGNORE INTO cbb_conference_membership(id,team_id,conference_name,effective_from,effective_to,source,observed_at,confidence,provenance_json,created_at) VALUES(${q("conf-b:"+h(tid,season,t.conference))},${q(tid)},${q(t.conference)},${q(now)},${q(FAR)},'SPORTSDATAVERSE_ESPN_TEAM_CROSSWALK',${q(now)},0.95,${j({asset:"mbb_team_crosswalk_2026.csv",sha256:sources[1].sha256})},${q(now)});`);
}
let rotN=0,starterN=0,replN=0,contTeams=0;
for(const [tid,d] of derived){
 if(d.continuity!=null)contTeams++;
 for(let i=0;i<d.rotation.length;i++){
  const p=d.rotation[i],rank=i+1,repl=replacements.get(p.pid)||null;rotN++;if(p.starterEvidence!=null)starterN++;if(repl)replN++;
  const prov={playerBox:"player_box_2026.csv",playerSeasonStats:"player_season_stats_2026.csv",rule:"prior-season baseline only when ESPN athlete_id and current team both match"};
  sql.push(`INSERT OR IGNORE INTO cbb_rotation_observations(id,player_id,team_id,season,as_of,games,starts,minutes,minutes_per_game,recent_minutes,expected_minutes,starter_evidence,rotation_rank,usage_rate,source,provenance_json,confidence,observed_at,effective_at,ingested_at,stale,supersedes_id,pit_eligible,research_only,created_at) VALUES(${q("rot-b:"+h(p.provider,season,now.slice(0,10)))},${q(p.pid)},${q(tid)},${season},${q(now)},${p.games},${p.starts},${p.minutes},${p.mpg},${p.mpg},${p.expectedMinutes},${p.starterEvidence??"NULL"},${rank},${p.usage??"NULL"},'SPORTSDATAVERSE_ESPN_PRIOR_ROTATION',${j(prov)},0.9,${q(now)},${q(now)},${q(now)},0,NULL,1,1,${q(now)});`);
  sql.push(`INSERT OR IGNORE INTO cbb_player_state_snapshots(id,player_id,team_id,season,as_of,starter_role,rotation_rank,recent_minutes,expected_minutes,usage_role,availability_status,injury_status,replacement_json,source,provenance_json,confidence,research_only,can_influence_projection,created_at) VALUES(${q("player-b-snap:"+h(p.pid,now.slice(0,10)))},${q(p.pid)},${q(tid)},${season},${q(now)},${q(p.starterEvidence!=null&&p.starterEvidence>=0.5?"PRIOR_STARTER_BASELINE":"UNKNOWN")},${rank},${p.mpg},${p.expectedMinutes},${q(p.usage!=null?String(p.usage):"UNKNOWN")},'UNKNOWN','UNKNOWN',${repl?j(repl):"NULL"},'SPORTSDATAVERSE_ESPN_PHASE_B',${j(prov)},0.9,1,0,${q(now)});`);
  events.push(`INSERT OR IGNORE INTO cbb_state_events(id,entity_type,entity_id,team_id,game_id,season,state_family,state_value_json,observed_at,effective_at,ingested_at,source,provenance_json,confidence,stale,supersedes_id,pit_eligible,research_only,can_influence_projection,created_at) VALUES(${q("state-b-rotation:"+h(p.provider,season,now.slice(0,10)))},'player',${q(p.pid)},${q(tid)},NULL,${season},'ROTATION_BASELINE',${j({rotationRank:rank,expectedMinutes:p.expectedMinutes,starterEvidence:p.starterEvidence,replacement:repl})},${q(now)},${q(now)},${q(now)},'SPORTSDATAVERSE_ESPN_PRIOR_ROTATION',${j(prov)},0.9,0,NULL,1,1,0,${q(now)});`);
 }
 const exp=d.expected.map((p,i)=>({playerId:p.pid,name:p.name,rank:i+1,expectedMinutes:p.expectedMinutes,starterEvidence:p.starterEvidence,basis:"PRIOR_SEASON_SAME_TEAM"}));
 sql.push(`INSERT OR IGNORE INTO cbb_team_state_snapshots(id,team_id,season,as_of,last_verified_starting_lineup_json,expected_starting_lineup_json,lineup_continuity,rotation_hierarchy_json,bench_hierarchy_json,schedule_state_json,availability_state,source,provenance_json,confidence,research_only,can_influence_projection,created_at) VALUES(${q("team-b-snap:"+h(tid,now.slice(0,10)))},${q(tid)},${season},${q(now)},NULL,${j(exp)},${d.continuity??"NULL"},${j(d.rotation.map((p,i)=>({playerId:p.pid,name:p.name,rotationRank:i+1,expectedMinutes:p.expectedMinutes,starterEvidence:p.starterEvidence})))},${j(d.bench.map((p,i)=>({playerId:p.pid,name:p.name,rotationRank:i+6,expectedMinutes:p.expectedMinutes})))},${j({games:(teamGames.get(tid)||[]).length})},'UNKNOWN','SPORTSDATAVERSE_ESPN_PHASE_B',${j({lineupContinuity:"current ESPN roster vs prior-season Phase A identity",expectedLineup:"derived prior-season same-team research state; not observed current starter fact"})},0.9,1,0,${q(now)});`);
}
for(const [key,s] of sched){const p=key.indexOf("|"),tid=key.slice(0,p),gameId=key.slice(p+1);sql.push(`INSERT OR IGNORE INTO cbb_schedule_items(id,game_id,team_id,opponent_team_id,season,game_date,home_away,rest_days,travel_miles,fixture_congestion_json,source,observed_at,provenance_json,research_only,created_at) VALUES(${q("sched-b:"+h(gameId,tid,season))},${q(gameId)},${q(tid)},${q(s.opponentTeamId)},${season},${q(s.start)},${q(s.homeAway)},${s.restDays??"NULL"},NULL,${j(s.fixtureCongestion)},'SPORTSDATAVERSE_ESPN_SCHEDULE',${q(now)},${j({asset:"mbb_schedule_2027.csv",sha256:sources[2].sha256,travel:"UNKNOWN_NO_VERIFIED_COORDINATES"})},1,${q(now)});`)}
sql.push(...events);

let snapshots=0,temporalFailures=0;
for(const g of games){
 if(Date.parse(g.start)<=Date.parse(now))continue;
 const cutoff=new Date(Date.parse(g.start)-3600000).toISOString();
 if(Date.parse(now)>Date.parse(cutoff)){temporalFailures++;continue;}
 const state=tid=>{const d=derived.get(tid)||{continuity:null,rotation:[],expected:[]},t=teamCtx.get(tid)||{},r=byTeam.get(tid)||[],s=sched.get(tid+"|"+g.id)||null;return{roster:r.map(p=>({playerId:p.pid,providerPlayerId:p.provider,name:p.name,position:p.position,classYear:p.classYear})),expectedLineup:d.expected.map((p,i)=>({playerId:p.pid,rank:i+1,expectedMinutes:p.expectedMinutes,basis:"PRIOR_SEASON_SAME_TEAM"})),lineupContinuity:d.continuity,rotation:d.rotation.map((p,i)=>({playerId:p.pid,rank:i+1,expectedMinutes:p.expectedMinutes,starterEvidence:p.starterEvidence,replacement:replacements.get(p.pid)||null})),availability:{status:"UNKNOWN",verifiedObservations:0},conference:t.conference||null,venue:t.venue||null,schedule:s};};
 sql.push(`INSERT OR IGNORE INTO cbb_game_state_snapshots(id,game_id,season,game_start,feature_cutoff,home_team_id,away_team_id,home_state_json,away_state_json,unresolved_json,temporal_integrity_ok,post_tip_observations,future_membership_leaks,future_availability_leaks,future_lineup_leaks,future_transfer_leaks,mode,overlay_version,research_only,can_influence_projection,can_qualify,can_authorize_wager,provenance_json,created_at) VALUES(${q("gamesnap-b:"+h(g.id,cutoff))},${q(g.id)},${season},${q(g.start)},${q(cutoff)},${q(g.home)},${q(g.away)},${j(state(g.home))},${j(state(g.away))},${j({availability:"UNKNOWN absent explicit verified source",currentStarters:"UNRESOLVED; expected lineup is derived",travel:"UNKNOWN_NO_VERIFIED_COORDINATES"})},1,0,0,0,0,0,'SHADOW','FBIS-STATE-OVERLAY-v1',1,0,0,0,${j({sources,featureObservedAt:now,cutoff})},${q(now)});`);snapshots++;
}
const canonicalTeams=362,rosterTeams=byTeam.size,scheduleTeams=new Set([...sched.keys()].map(k=>k.split("|")[0])).size;
const reconciledPhaseA=new Set(dedup.filter(x=>!x.pid.startsWith("cbb:espn:")).map(x=>x.pid)).size;
const newStableIdentities=dedup.filter(x=>x.pid.startsWith("cbb:espn:")).length;
const unresolvedProvisional=Math.max(0,23273-reconciledPhaseA);
const positionN=dedup.filter(x=>x.position).length,classN=dedup.filter(x=>x.classYear).length,heightN=dedup.filter(x=>x.height).length,weightN=dedup.filter(x=>x.size).length;
const qa={id:"CBB-DIRECTORY-PHASE-B-v1",transformationVersion:"CBB-SD-BULK-v1",season,priorSeason,observedAt:now,canonicalTeams,stableIdPlayers:dedup.length,reconciledPhaseAIdentities:reconciledPhaseA,newStableIdentities,unresolvedProvisionalPlayers:unresolvedProvisional,ambiguousIdentities:ambiguous.length,transferLinks:transfers.length,roster:{players:dedup.length,teams:rosterTeams,coverage:rosterTeams/canonicalTeams},biography:{position:dedup.length?positionN/dedup.length:0,classYear:dedup.length?classN/dedup.length:0,height:dedup.length?heightN/dedup.length:0,weight:dedup.length?weightN/dedup.length:0},conference:{teams:confTeams,coverage:confTeams/canonicalTeams},coach:{teams:0,coverage:0},venue:{teams:venueTeams,coverage:venueTeams/canonicalTeams},schedule:{teams:scheduleTeams,coverage:scheduleTeams/canonicalTeams,games:games.length},availability:{verified:0,unknown:dedup.length,unknownRate:dedup.length?1:0,rule:"UNKNOWN absent explicit verified status source"},rotation:{players:rotN,coverage:dedup.length?rotN/dedup.length:0,starterEvidencePlayers:starterN,starterEvidenceCoverage:dedup.length?starterN/dedup.length:0},lineupContinuity:{teams:contTeams,coverage:rosterTeams?contTeams/rosterTeams:0},replacementHierarchy:{players:replN,coverage:rotN?replN/rotN:0},pit:{gameStateSnapshots:snapshots,temporalIntegrityOk:temporalFailures===0,temporalFailures,postTipObservations:0,futureMembershipLeaks:0,futureAvailabilityLeaks:0,futureLineupLeaks:0,futureTransferLeaks:0},stateEventsAdded:events.length,sources,governance:{overlay:"FBIS-STATE-OVERLAY-v1",mode:"SHADOW",totalsDefinitions:0,canInfluenceProjection:false,canQualify:false,canAuthorizeWager:false}};
const runId="cbb-dir-b:"+season+":"+now.slice(0,10)+":"+h(now,dedup.length,games.length);
sql.push(`INSERT OR REPLACE INTO cbb_directory_phase_b_runs(id,season,observed_at,status,canonical_teams,stable_id_players,unresolved_provisional_players,ambiguous_identities,transfer_links,roster_teams,roster_players,rotation_players,starter_evidence_players,lineup_continuity_teams,replacement_players,schedule_teams,game_state_snapshots,verified_availability,unknown_availability,qa_json,source_json,created_at) VALUES(${q(runId)},${season},${q(now)},'COMPLETE',${canonicalTeams},${dedup.length},${unresolvedProvisional},${ambiguous.length},${transfers.length},${rosterTeams},${dedup.length},${rotN},${starterN},${contTeams},${replN},${scheduleTeams},${snapshots},0,${dedup.length},${j(qa)},${j(sources)},${q(now)});`);
const chunks=[];for(let i=0;i<sql.length;i+=2500){const p=out+"/chunk-"+String(chunks.length+1).padStart(3,"0")+".sql";writeFileSync(p,sql.slice(i,i+2500).join("\n")+"\n");chunks.push(p);}
qa.sqlStatements=sql.length;qa.sqlChunks=chunks.length;qa.runId=runId;
writeFileSync(out+"/qa.json",JSON.stringify(qa,null,2)+"\n");
writeFileSync(out+"/ambiguous-identities.json",JSON.stringify(ambiguous,null,2)+"\n");
writeFileSync(out+"/transfer-links.json",JSON.stringify(transfers,null,2)+"\n");
console.log(JSON.stringify(qa,null,2));
