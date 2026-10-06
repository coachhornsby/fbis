import {readFileSync,readdirSync,writeFileSync,mkdirSync} from "node:fs";
import {createHash} from "node:crypto";
import cbbTeams from "../data/teams/cbb.js";
import {mapSourceTeam} from "../functions/lib/collegeIdentity.js";
import {buildCbbPlayerId,normalizeCbbIdentity,CBB_DIRECTORY_SNAPSHOT} from "../functions/lib/cbbPersistentDirectory.js";

const SRC=process.argv[2]||"artifacts/source/parts";
const OUT=process.argv[3]||"artifacts/cbb-directory";
const SOURCE_RUN="37411381038",SOURCE_SHA="910b262c0d78f69aae2e3158f1ef6b26431fd7d0";
const OBSERVED_AT="2026-10-06T03:57:01.000Z";
mkdirSync(OUT,{recursive:true});
const esc=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const js=v=>esc(JSON.stringify(v));
const hid=(...p)=>createHash("sha256").update(p.map(x=>String(x??"")).join("|")).digest("hex").slice(0,32);
const isoDate=v=>{const raw=String(v||"").trim();const s=raw.slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s+"T23:59:59.000Z";const m=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);return m?`${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}T23:59:59.000Z`:null};
const sql=[];
const qa={version:"cbb-directory-phase-a-v1",snapshotId:CBB_DIRECTORY_SNAPSHOT,sourceRun:SOURCE_RUN,sourceSha:SOURCE_SHA,generatedAt:new Date().toISOString(),canonicalTeams:0,players:0,rosterMemberships:0,stateEvents:0,teamSnapshots:0,playerSnapshots:0,scheduleItems:0,coverage:{},missing:{conference:[],coach:[],venue:[]},provenance:["repo:data/teams/cbb.js","run:37411381038:cbb-possession-history-2018..2025","snapshot:CBB-PIT-RESEARCH-v1-37411381038"],governance:{overlayVersion:"FBIS-STATE-OVERLAY-v1",researchOnly:true,canInfluenceProjection:false,canQualify:false,canAuthorizeWager:false,availabilityRule:"UNKNOWN remains UNKNOWN; missing minutes/appearances are not injury evidence",totalsPolicy:"All current directory-derived families remain excluded from totals production."}};

const teamRows=new Map();
for(const t of cbbTeams.filter(x=>String(x.classification||"").toUpperCase()==="D1")){
  teamRows.set(t.id,t);
  sql.push(`INSERT INTO cbb_canonical_teams(team_id,espn_team_id,school_name,display_name,abbreviation,classification,active,current_conference,home_venue,hca_reference,head_coach_name,coach_tenure_start,identity_confidence,source_json,first_observed_at,last_observed_at,research_only,can_influence_projection,created_at,updated_at) VALUES(${esc(t.id)},${esc(t.espnId)},${esc(t.school||t.displayName)},${esc(t.displayName)},${esc(t.abbr)},'D1',1,${esc(t.conference)},NULL,NULL,NULL,NULL,1.0,${js({registry:"data/teams/cbb.js",sources:t.sources||null})},${esc(OBSERVED_AT)},${esc(OBSERVED_AT)},1,0,${esc(OBSERVED_AT)},${esc(OBSERVED_AT)}) ON CONFLICT(team_id) DO UPDATE SET school_name=excluded.school_name,display_name=excluded.display_name,abbreviation=excluded.abbreviation,classification='D1',active=1,source_json=excluded.source_json,last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at;`);
  const aliases=[t.school,t.displayName,t.abbr,t.sources?.espn?.name,...(t.sources?.parlay?.names||[]),...(t.sources?.heritage?.names||[]),...(t.sources?.kalshi?.names||[])];
  for(const a of new Set(aliases.filter(Boolean))){const n=normalizeCbbIdentity(a);if(!n)continue;sql.push(`INSERT OR IGNORE INTO cbb_team_aliases(id,team_id,alias,normalized_alias,source,effective_from,effective_to,observed_at,confidence,created_at) VALUES(${esc("alias:"+hid(t.id,n))},${esc(t.id)},${esc(a)},${esc(n)},'CANONICAL_REGISTRY',NULL,NULL,${esc(OBSERVED_AT)},1.0,${esc(OBSERVED_AT)});`)}
}
qa.canonicalTeams=teamRows.size;

const playerMap=new Map(), memberships=new Map(), teamSeason=new Map(), schedules=[], stateEvents=[];
const files=readdirSync(SRC).filter(x=>/^cbb-possession-history-20\d\d\.json$/.test(x)).sort();
if(files.length!==8)throw new Error("expected_8_immutable_season_artifacts");
for(const file of files){
  const pack=JSON.parse(readFileSync(SRC+"/"+file,"utf8")),season=Number(pack.season);
  for(const g of (pack.games||[]).filter(x=>x.ok!==false&&x.gameId)){
    const effective=isoDate(g.date); if(!effective)continue;
    const sides=[["home",g.homeTeamId,g.homeTeamName,g.awayTeamName,g.home],["away",g.awayTeamId,g.awayTeamName,g.homeTeamName,g.away]];
    const resolved={};
    for(const [ha,sourceId,name,oppName,side] of sides){
      const m=mapSourceTeam("cbb",{id:sourceId,team:name,school:name},season);
      const teamId=m?.ok?m.canonicalId:null; resolved[ha]=teamId;
      if(!teamId||!teamRows.has(teamId))continue;
      const lineups=side?.topFiveLineups||[], names=[...new Set(lineups.flatMap(z=>z.players||[]).map(String).filter(Boolean))];
      const key=teamId+"|"+season, ts=teamSeason.get(key)||{teamId,season,games:0,players:new Map(),lastDate:null,lastLineups:[],lineupReliableGames:0,validatedCoverageSum:0};
      ts.games++; if(g.lineupReliable)ts.lineupReliableGames++;ts.validatedCoverageSum+=Number(g.qa?.validatedLineupCoverage||0);
      if(!ts.lastDate||effective>ts.lastDate){ts.lastDate=effective;ts.lastLineups=lineups.slice(0,10)}
      for(const name0 of names){
        const pid=buildCbbPlayerId({teamId,name:name0}), p=playerMap.get(pid)||{id:pid,name:name0,teamId,first:effective,last:effective,seasons:new Set()};
        p.first=p.first<effective?p.first:effective;p.last=p.last>effective?p.last:effective;p.seasons.add(season);playerMap.set(pid,p);
        const pk=pid+"|"+teamId+"|"+season, pm=memberships.get(pk)||{pid,teamId,season,first:effective,last:effective,appearances:0};
        pm.first=pm.first<effective?pm.first:effective;pm.last=pm.last>effective?pm.last:effective;pm.appearances++;memberships.set(pk,pm);
        ts.players.set(pid,(ts.players.get(pid)||0)+1);
      }
      teamSeason.set(key,ts);
      stateEvents.push({id:"state:"+hid(teamId,g.gameId,"LINEUP_ROTATION"),entityType:"team",entityId:teamId,teamId,gameId:String(g.gameId),season,family:"LINEUP_ROTATION_OBSERVATION",value:{lineupReliable:g.lineupReliable===true,validatedLineupCoverage:Number(g.qa?.validatedLineupCoverage||0),lineups:lineups.slice(0,2).map(z=>({p:(z.players||[]).map(String),o:Number(z.possessions||0),d:Number(z.defensivePossessions||0),n:Number(z.netRating||0)}))},effective,confidence:g.lineupReliable?0.95:0.65});
    }
    if(resolved.home&&resolved.away){
      schedules.push({id:"sched:"+hid(g.gameId,resolved.home),gameId:String(g.gameId),teamId:resolved.home,opp:resolved.away,season,date:effective,ha:"HOME"});
      schedules.push({id:"sched:"+hid(g.gameId,resolved.away),gameId:String(g.gameId),teamId:resolved.away,opp:resolved.home,season,date:effective,ha:"AWAY"});
    }
  }
}

for(const p of playerMap.values()){
  sql.push(`INSERT INTO cbb_players(player_id,canonical_name,identity_status,provider_player_id,position,class_year,height_text,size_text,first_observed_at,last_observed_at,source_json,research_only,can_influence_projection,created_at,updated_at) VALUES(${esc(p.id)},${esc(p.name)},'PROVISIONAL',NULL,NULL,NULL,NULL,NULL,${esc(p.first)},${esc(p.last)},${js({basis:"validated lineup player-name evidence",snapshotId:CBB_DIRECTORY_SNAPSHOT})},1,0,${esc(OBSERVED_AT)},${esc(OBSERVED_AT)}) ON CONFLICT(player_id) DO UPDATE SET last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at;`);
  const n=normalizeCbbIdentity(p.name);sql.push(`INSERT OR IGNORE INTO cbb_player_aliases(id,player_id,alias,normalized_alias,source,observed_at,confidence,created_at) VALUES(${esc("palias:"+hid(p.id,n))},${esc(p.id)},${esc(p.name)},${esc(n)},'FROZEN_LINEUP_HISTORY',${esc(OBSERVED_AT)},0.8,${esc(OBSERVED_AT)});`);
}
for(const m of memberships.values()){
  const from=m.first,to=new Date(Date.parse(m.last)+86400000).toISOString();
  sql.push(`INSERT OR IGNORE INTO cbb_roster_membership(id,player_id,team_id,season,effective_from,effective_to,pit_resolvable,membership_basis,source,observed_at,confidence,provenance_json,created_at) VALUES(${esc("member:"+hid(m.pid,m.teamId,m.season))},${esc(m.pid)},${esc(m.teamId)},${m.season},${esc(from)},${esc(to)},1,'LINEUP_PARTICIPATION','CBB-PIT-RESEARCH-v1-37411381038',${esc(OBSERVED_AT)},0.8,${js({sourceRun:SOURCE_RUN,sourceSha:SOURCE_SHA,appearances:m.appearances})},${esc(OBSERVED_AT)});`);
}
for(const e of stateEvents){
  sql.push(`INSERT OR IGNORE INTO cbb_state_events(id,entity_type,entity_id,team_id,game_id,season,state_family,state_value_json,observed_at,effective_at,ingested_at,source,provenance_json,confidence,stale,supersedes_id,pit_eligible,research_only,can_influence_projection,created_at) VALUES(${esc(e.id)},${esc(e.entityType)},${esc(e.entityId)},${esc(e.teamId)},${esc(e.gameId)},${e.season},${esc(e.family)},${js(e.value)},${esc(OBSERVED_AT)},${esc(e.effective)},${esc(OBSERVED_AT)},'CBB-PIT-RESEARCH-v1-37411381038',${js({sourceRun:SOURCE_RUN,sourceSha:SOURCE_SHA,reconstruction:"retrospective-prior-game-safe"})},${e.confidence},0,NULL,1,1,0,${esc(OBSERVED_AT)});`);
}
for(const s of schedules.sort((a,b)=>a.teamId.localeCompare(b.teamId)||a.date.localeCompare(b.date))){
  sql.push(`INSERT OR IGNORE INTO cbb_schedule_items(id,game_id,team_id,opponent_team_id,season,game_date,home_away,rest_days,travel_miles,fixture_congestion_json,source,observed_at,provenance_json,research_only,created_at) VALUES(${esc(s.id)},${esc(s.gameId)},${esc(s.teamId)},${esc(s.opp)},${s.season},${esc(s.date)},${esc(s.ha)},NULL,NULL,${js({rest:"not materialized in Phase A",travel:"UNKNOWN"})},'CBB-PIT-RESEARCH-v1-37411381038',${esc(OBSERVED_AT)},${js({sourceRun:SOURCE_RUN,sourceSha:SOURCE_SHA})},1,${esc(OBSERVED_AT)});`);
}
for(const ts of teamSeason.values()){
  const rank=[...ts.players.entries()].sort((a,b)=>b[1]-a[1]).map(([playerId,appearances],i)=>({playerId,rotationRank:i+1,appearances}));
  const sid="team-snap:"+hid(ts.teamId,ts.season);
  sql.push(`INSERT OR IGNORE INTO cbb_team_state_snapshots(id,team_id,season,as_of,last_verified_starting_lineup_json,expected_starting_lineup_json,lineup_continuity,rotation_hierarchy_json,bench_hierarchy_json,schedule_state_json,availability_state,source,provenance_json,confidence,research_only,can_influence_projection,created_at) VALUES(${esc(sid)},${esc(ts.teamId)},${ts.season},${esc(ts.lastDate)},NULL,NULL,NULL,${js(rank.slice(0,20))},NULL,${js({games:ts.games})},'UNKNOWN','CBB-PIT-RESEARCH-v1-37411381038',${js({sourceRun:SOURCE_RUN,sourceSha:SOURCE_SHA,lineupReliableRate:ts.games?ts.lineupReliableGames/ts.games:0,meanValidatedCoverage:ts.games?ts.validatedCoverageSum/ts.games:0})},${ts.games?ts.lineupReliableGames/ts.games:0},1,0,${esc(OBSERVED_AT)});`);
  rank.forEach((r,i)=>sql.push(`INSERT OR IGNORE INTO cbb_player_state_snapshots(id,player_id,team_id,season,as_of,starter_role,rotation_rank,recent_minutes,expected_minutes,usage_role,availability_status,injury_status,replacement_json,source,provenance_json,confidence,research_only,can_influence_projection,created_at) VALUES(${esc("player-snap:"+hid(r.playerId,ts.season))},${esc(r.playerId)},${esc(ts.teamId)},${ts.season},${esc(ts.lastDate)},'UNKNOWN',${i+1},NULL,NULL,'ROTATION_PARTICIPANT','UNKNOWN','UNKNOWN',NULL,'CBB-PIT-RESEARCH-v1-37411381038',${js({sourceRun:SOURCE_RUN,sourceSha:SOURCE_SHA,appearances:r.appearances})},0.8,1,0,${esc(OBSERVED_AT)});`));
}
qa.players=playerMap.size;qa.rosterMemberships=memberships.size;qa.stateEvents=stateEvents.length;qa.teamSnapshots=teamSeason.size;qa.playerSnapshots=[...teamSeason.values()].reduce((n,x)=>n+x.players.size,0);qa.scheduleItems=schedules.length;
const teamsWithPlayers=new Set([...memberships.values()].map(x=>x.teamId));
const teamsWithSchedule=new Set(schedules.map(x=>x.teamId));
qa.coverage={rosterTeamCoverage:qa.canonicalTeams?teamsWithPlayers.size/qa.canonicalTeams:0,historicalScheduleTeamCoverage:qa.canonicalTeams?teamsWithSchedule.size/qa.canonicalTeams:0,historicalLineupRotationLinkage:stateEvents.length?stateEvents.filter(x=>x.value.lineups?.length).length/stateEvents.length:0,conferenceCoverage:[...teamRows.values()].filter(x=>x.conference).length/qa.canonicalTeams,coachCoverage:0,venueCoverage:0,availabilityVerifiedCoverage:0};
qa.missing.conference=[...teamRows.values()].filter(x=>!x.conference).map(x=>x.id);qa.missing.coach=[...teamRows.keys()];qa.missing.venue=[...teamRows.keys()];
const runId="cbb-dir-a:"+hid(CBB_DIRECTORY_SNAPSHOT,SOURCE_SHA);
sql.push(`INSERT OR REPLACE INTO cbb_directory_population_runs(id,snapshot_id,source_run_id,source_sha,status,canonical_teams,players,roster_memberships,state_events,team_snapshots,player_snapshots,schedule_items,qa_json,started_at,completed_at,created_at) VALUES(${esc(runId)},${esc(CBB_DIRECTORY_SNAPSHOT)},${esc(SOURCE_RUN)},${esc(SOURCE_SHA)},'COMPLETE',${qa.canonicalTeams},${qa.players},${qa.rosterMemberships},${qa.stateEvents},${qa.teamSnapshots},${qa.playerSnapshots},${qa.scheduleItems},${js(qa)},${esc(OBSERVED_AT)},${esc(new Date().toISOString())},${esc(OBSERVED_AT)});`);

const CHUNK=4000;let chunk=0,totalBytes=0;
// Wrangler/D1 remote import owns transaction boundaries; explicit BEGIN/COMMIT is rejected.\nfor(let i=0;i<sql.length;i+=CHUNK){const p=`${OUT}/chunk-${String(++chunk).padStart(3,"0")}.sql`,body=sql.slice(i,i+CHUNK).join("\n")+"\n";writeFileSync(p,body);totalBytes+=Buffer.byteLength(body)}
qa.sqlStatements=sql.length;qa.sqlChunks=chunk;qa.storageFootprintBytes=totalBytes;
writeFileSync(OUT+"/qa.json",JSON.stringify(qa,null,2)+"\n");
console.log(JSON.stringify(qa,null,2));
