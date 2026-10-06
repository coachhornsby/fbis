import {cbbdGet,cbbSeasonYear} from "./collegeApi.js";
import {mapSourceTeam} from "./collegeIdentity.js";
import {normalizeCbbIdentity} from "./cbbPersistentDirectory.js";
import hcaCatalog from "../../research/cbb/kenpom-hca-2025-26.json" assert { type: "json" };

const nowIso=()=>new Date().toISOString();
const num=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const norm=normalizeCbbIdentity;
const chunk=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));
const teamId=(season,name,id)=>{const m=mapSourceTeam("cbb",{id,team:name,school:name},season);return m?.ok?m.canonicalId:null};
const rosterPlayers=r=>Array.isArray(r?.players)?r.players:Array.isArray(r?.roster)?r.roster:[];
const playerProviderId=p=>String(p?.id??p?.sourceId??p?.source_id??p?.athleteId??p?.athleteSourceId??p?.athlete?.id??"");
const playerName=p=>p?.name||p?.displayName||p?.athlete?.displayName||p?.athlete||[p?.firstName??p?.first_name,p?.lastName??p?.last_name].filter(Boolean).join(" ");
const teamName=x=>x?.team||x?.school||x?.name||x?.displayName||null;
const conf=x=>x?.conference||x?.conferenceAbbreviation||x?.conference?.abbreviation||x?.conference?.name||null;
const venue=x=>x?.venue||x?.venueName||x?.homeVenue||x?.venue?.name||null;

async function all(db,sql,...args){return (await db.prepare(sql).bind(...args).all()).results||[]}
async function runBatches(db,stmts){for(const c of chunk(stmts,80))await db.batch(c)}

export async function runCbbDirectoryPhaseB(env,{asOf=new Date()}={}){
 const observedAt=asOf.toISOString();
 const season=cbbSeasonYear(asOf), priorSeason=season-1;
 const [rosterRes,teamRes,gameRes,statRes]=await Promise.all([
  cbbdGet("/teams/roster",env,{query:{season},skipCache:true}),
  cbbdGet("/teams",env,{query:{season},skipCache:true}),
  cbbdGet("/games",env,{query:{season},skipCache:true}),
  cbbdGet("/stats/player/season",env,{query:{season:priorSeason,seasonType:"regular"},skipCache:true}),
 ]);
 const sourceStatus={roster:rosterRes.ok,teams:teamRes.ok,games:gameRes.ok,priorStats:statRes.ok};
 if(!Object.values(sourceStatus).every(Boolean))return {ok:false,status:"SOURCE_FAILED",season,priorSeason,sourceStatus,
  reasons:[rosterRes.reason,teamRes.reason,gameRes.reason,statRes.reason].filter(Boolean)};
 const rosters=Array.isArray(rosterRes.data)?rosterRes.data:[],teams=Array.isArray(teamRes.data)?teamRes.data:[],
  games=Array.isArray(gameRes.data)?gameRes.data:[],stats=Array.isArray(statRes.data)?statRes.data:[];
 if(!rosters.length||!teams.length)return {ok:false,status:"EMPTY_SOURCE",season,counts:{rosters:rosters.length,teams:teams.length,games:games.length,stats:stats.length}};

 const prior=await all(env.DB,`SELECT DISTINCT p.player_id,p.canonical_name,m.team_id
 FROM cbb_players p JOIN cbb_roster_membership m ON m.player_id=p.player_id`);
 const priorBy=new Map();
 for(const p of prior){const k=p.team_id+"|"+norm(p.canonical_name);if(!priorBy.has(k))priorBy.set(k,[]);priorBy.get(k).push(p)}
 const current=[],ambiguous=[];const rosterStmts=[],providerStmts=[],playerStmts=[];
 for(const tr of rosters){
  const tid=teamId(season,teamName(tr),tr?.teamId??tr?.team_id??tr?.teamSourceId??tr?.team_source_id??tr?.id);if(!tid)continue;
  for(const p of rosterPlayers(tr)){
   const provider=playerProviderId(p),name=playerName(p);if(!provider||!name)continue;
   const hits=priorBy.get(tid+"|"+norm(name))||[];let pid;
   if(hits.length===1)pid=hits[0].player_id;
   else if(hits.length>1){ambiguous.push({provider,name,teamId:tid,candidates:hits.map(x=>x.player_id)});continue}
   else pid="cbb:provider:"+provider;
   current.push({pid,provider,tid,name,p});
   playerStmts.push(env.DB.prepare(`INSERT INTO cbb_players(player_id,canonical_name,identity_status,provider_player_id,position,class_year,height_text,size_text,first_observed_at,last_observed_at,source_json,research_only,can_influence_projection,created_at,updated_at)
    VALUES(?,?, 'STABLE_PROVIDER',?,?,?,?,?,?,?, ?,1,0,?,?)
    ON CONFLICT(player_id) DO UPDATE SET canonical_name=excluded.canonical_name,identity_status='STABLE_PROVIDER',provider_player_id=excluded.provider_player_id,
    position=COALESCE(excluded.position,cbb_players.position),class_year=COALESCE(excluded.class_year,cbb_players.class_year),
    height_text=COALESCE(excluded.height_text,cbb_players.height_text),size_text=COALESCE(excluded.size_text,cbb_players.size_text),
    last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at`).bind(pid,name,provider,p.position??p.positionAbbreviation??null,p.year??p.classYear??p.class??p.startSeason??p.start_season??null,p.height??p.heightText??null,p.weight??p.weightText??null,observedAt,observedAt,JSON.stringify({source:"CBBD /teams/roster",season}),observedAt,observedAt));
   providerStmts.push(env.DB.prepare(`INSERT OR REPLACE INTO cbb_player_provider_ids(id,player_id,provider,provider_player_id,evidence_type,observed_at,confidence,provenance_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind("provider:CBBD:"+provider,pid,"CBBD",provider,"EXACT_PROVIDER_ROSTER_ID",observedAt,1,JSON.stringify({endpoint:"/teams/roster",season,team:teamName(tr)}),observedAt));
   rosterStmts.push(env.DB.prepare(`INSERT OR IGNORE INTO cbb_roster_observations(id,player_id,team_id,season,provider_player_id,canonical_name,position,class_year,height_text,observed_at,effective_at,ingested_at,source,provenance_json,confidence,stale,supersedes_id,pit_eligible,research_only,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,NULL,1,1,?)`).bind("roster-b:"+season+":"+provider+":"+tid,pid,tid,season,provider,name,p.position??p.positionAbbreviation??null,p.year??p.classYear??p.class??p.startSeason??p.start_season??null,p.height??p.heightText??null,observedAt,observedAt,observedAt,"CBBD_TEAMS_ROSTER",JSON.stringify({endpoint:"/teams/roster",season}),observedAt));
  }
 }
 await runBatches(env.DB,[...playerStmts,...providerStmts,...rosterStmts]);

 const teamCtx=new Map(),teamStmts=[];
 for(const t of teams){
  const tid=teamId(season,teamName(t),t?.id??t?.teamId??t?.team_id??t?.sourceId??t?.source_id);if(!tid)continue;teamCtx.set(tid,t);
  const hca=null;
  teamStmts.push(env.DB.prepare(`INSERT OR REPLACE INTO cbb_team_context_observations(id,team_id,season,conference,head_coach,coach_tenure_start,venue_id,venue_name,venue_latitude,venue_longitude,hca_reference,observed_at,effective_at,ingested_at,source,provenance_json,confidence,stale,supersedes_id,pit_eligible,research_only,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,NULL,1,1,?)`).bind("teamctx:"+season+":"+tid,tid,season,conf(t),t?.headCoach??t?.coach?.name??null,t?.coachTenureStart??null,t?.venueId??t?.venue?.id??null,venue(t),num(t?.venue?.latitude),num(t?.venue?.longitude),num(hca),observedAt,observedAt,observedAt,"CBBD_TEAMS",JSON.stringify({endpoint:"/teams",season,hca:"UNRESOLVED_NO_VERIFIED_TEAM_SPECIFIC_LINK"}),0.95,observedAt));
 }
 await runBatches(env.DB,teamStmts);

 const statBy=new Map(stats.map(s=>[String(s?.athleteId??s?.athleteSourceId??s?.id??""),s]));
 const rotationStmts=[];let starterEvidence=0;
 for(const cp of current){
  const s=statBy.get(cp.provider);if(!s)continue;
  const stid=teamId(priorSeason,s.team,s.teamId);if(stid!==cp.tid)continue;
  const gn=num(s.games)||0,mins=num(s.minutes)||0,mpg=gn?mins/gn:null,starts=num(s.starts)||0;
  if(gn>0)starterEvidence++;
  rotationStmts.push(env.DB.prepare(`INSERT OR REPLACE INTO cbb_rotation_observations(id,player_id,team_id,season,as_of,games,starts,minutes,minutes_per_game,recent_minutes,expected_minutes,starter_evidence,rotation_rank,usage_rate,source,provenance_json,confidence,observed_at,effective_at,ingested_at,stale,supersedes_id,pit_eligible,research_only,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,0,NULL,1,1,?)`).bind("rot:"+season+":"+cp.provider,cp.pid,cp.tid,season,observedAt,gn,starts,mins,mpg,mpg,mpg==null?null:Math.max(0,Math.min(40,mpg)),gn?starts/gn:0,num(s.usage),"CBBD_PLAYER_SEASON_PRIOR",JSON.stringify({endpoint:"/stats/player/season",sourceSeason:priorSeason,rule:"provider team must match verified current roster team"}),0.75,observedAt,observedAt,observedAt,observedAt));
 }
 await runBatches(env.DB,rotationStmts);

 const currentByTeam=new Map();for(const p of current){if(!currentByTeam.has(p.tid))currentByTeam.set(p.tid,[]);currentByTeam.get(p.tid).push(p)}
 const gameStmts=[];let temporalFailures=0;
 for(const g of games){
  const start=g?.startDate||g?.start_date||g?.date;if(!start||Date.parse(start)<=asOf.getTime())continue;
  const ht=teamId(season,g?.homeTeam||g?.homeTeamName,g?.homeTeamId),at=teamId(season,g?.awayTeam||g?.awayTeamName,g?.awayTeamId);if(!ht||!at)continue;
  const cutoff=new Date(Date.parse(start)-60*60*1000).toISOString();if(asOf.getTime()>Date.parse(cutoff)){temporalFailures++;continue}
  const state=tid=>({rosterObservedAt:observedAt,rosterPlayers:(currentByTeam.get(tid)||[]).map(p=>p.pid),availability:"UNKNOWN",availabilityEvidence:"NONE",rotationBaseline:"PRIOR_SEASON_SAME_TEAM_ONLY",conference:conf(teamCtx.get(tid)),hcaReference:null});
  gameStmts.push(env.DB.prepare(`INSERT OR REPLACE INTO cbb_game_state_snapshots(id,game_id,season,game_start,feature_cutoff,home_team_id,away_team_id,home_state_json,away_state_json,unresolved_json,temporal_integrity_ok,post_tip_observations,future_membership_leaks,future_availability_leaks,future_lineup_leaks,mode,overlay_version,research_only,can_influence_projection,can_qualify,can_authorize_wager,provenance_json,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,1,0,0,0,0,'SHADOW','FBIS-STATE-OVERLAY-v1',1,0,0,0,?,?)`).bind("gamesnap:"+String(g.id??g.gameId)+":"+cutoff,String(g.id??g.gameId),season,start,cutoff,ht,at,JSON.stringify(state(ht)),JSON.stringify(state(at)),JSON.stringify({availability:"UNKNOWN absent explicit verified source",coach:"UNRESOLVED unless source supplies it",travel:"UNRESOLVED unless verified venue coordinates"}),JSON.stringify({roster:"CBBD /teams/roster",teams:"CBBD /teams",games:"CBBD /games",priorStats:"CBBD /stats/player/season",observedAt}),observedAt));
 }
 await runBatches(env.DB,gameStmts);

 const stable=(await all(env.DB,"SELECT COUNT(*) n FROM cbb_player_provider_ids WHERE provider='CBBD'"))[0]?.n||0;
 const provisional=(await all(env.DB,"SELECT COUNT(*) n FROM cbb_players WHERE identity_status='PROVISIONAL'"))[0]?.n||0;
 const teamsRoster=new Set(current.map(x=>x.tid)).size;
 const pos=current.filter(x=>x.p.position||x.p.positionAbbreviation).length;
 const cls=current.filter(x=>x.p.year||x.p.classYear||x.p.class).length;
 const height=current.filter(x=>x.p.height||x.p.heightText).length;
 const confCount=[...teamCtx.values()].filter(x=>conf(x)).length,venueCount=[...teamCtx.values()].filter(x=>venue(x)).length;
 const qa={ok:temporalFailures===0,status:temporalFailures===0?"COMPLETE":"TEMPORAL_FAIL",season,priorSeason,observedAt,
  canonicalTeams:362,stableIdPlayers:Number(stable),unresolvedProvisionalPlayers:Number(provisional),ambiguousIdentities:ambiguous.length,
  transferIdentityLinks:0,currentRosterPlayers:current.length,rosterCoverage:teamsRoster/362,
  bioCoverage:{position:current.length?pos/current.length:0,classYear:current.length?cls/current.length:0,height:current.length?height/current.length:0},
  conferenceCoverage:confCount/362,coachCoverage:[...teamCtx.values()].filter(x=>x?.headCoach||x?.coach?.name).length/362,venueCoverage:venueCount/362,
  currentScheduleGames:games.length,verifiedAvailabilityCoverage:0,unknownAvailabilityCount:current.length,unknownAvailabilityRate:current.length?1:0,
  rotationCoverage:current.length?rotationStmts.length/current.length:0,starterEvidenceCoverage:current.length?starterEvidence/current.length:0,
  lineupContinuityCoverage:0,replacementHierarchyCoverage:0,pitGameStateSnapshots:gameStmts.length,
  temporalIntegrity:{ok:temporalFailures===0,postTipLeakage:0,futureMembershipLeakage:0,futureAvailabilityLeakage:0,futureLineupLeakage:0,cutoffFailures:temporalFailures},
  observationCounts:{roster:rosterStmts.length,rotation:rotationStmts.length,teamContext:teamStmts.length,availability:0,gameState:gameStmts.length},
  sourceProvenance:["CBBD /teams/roster","CBBD /teams","CBBD /games",`CBBD /stats/player/season season=${priorSeason}`,"Phase A CBB-PIT-RESEARCH-v1-37411381038"],
  governance:{overlay:"FBIS-STATE-OVERLAY-v1",mode:"SHADOW",totalsShadowDefinitions:0,canInfluenceProjection:false,canQualify:false,canAuthorizeWager:false,availabilityRule:"UNKNOWN absent explicit verified source"}};
 const scheduleTeams=new Set();
 for(const g of games){
  const ht=teamId(season,g?.homeTeam||g?.homeTeamName,g?.homeTeamId),at=teamId(season,g?.awayTeam||g?.awayTeamName,g?.awayTeamId);
  if(ht)scheduleTeams.add(ht);if(at)scheduleTeams.add(at);
 }
 await env.DB.prepare(`INSERT OR REPLACE INTO cbb_directory_phase_b_runs(id,season,observed_at,status,canonical_teams,stable_id_players,unresolved_provisional_players,ambiguous_identities,transfer_links,roster_teams,roster_players,rotation_players,starter_evidence_players,lineup_continuity_teams,replacement_players,schedule_teams,game_state_snapshots,verified_availability,unknown_availability,qa_json,source_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
  "cbb-dir-b:"+season+":"+observedAt.slice(0,10),season,observedAt,qa.status,362,qa.stableIdPlayers,qa.unresolvedProvisionalPlayers,qa.ambiguousIdentities,0,teamsRoster,current.length,rotationStmts.length,starterEvidence,0,0,scheduleTeams.size,gameStmts.length,0,current.length,JSON.stringify(qa),JSON.stringify({sources:qa.sourceProvenance}),observedAt
 ).run();
 return qa;
}
