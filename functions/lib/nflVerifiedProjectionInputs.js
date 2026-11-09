import {attachVerifiedNflScheduleContext} from './nflVerifiedScheduleContext.js';
/** Pure NFL-only consumer. No storage, network, schedules, writes or wager authority. */
import {attachNflGameMatchups} from './nflGameMatchup.js';
import teams from '../../data/teams/nfl.js';
import {attachNflVerseFeatures,validateNflFeatureSnapshot} from './nflVerseFeed.js';
import {attachNflProShadow} from './nflProModel.js';
import {promoteNflResearchToBoard} from './researchBoardPromote.js';
import {attachNflPlayerProjectionResearch} from './proPlayerProjectionLayer.js';
const canon=x=>x==='LA'?'LAR':x==='JAC'?'JAX':x;
const codes=new Set(teams.map(t=>canon(t.abbr)));
const byEspn=new Map(teams.map(t=>[String(t.espnId),canon(t.abbr)]));
const HOUR=3600000;
const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
const fail=reason=>{throw Error(reason);};
function time(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))fail('NFL_RECEIPT_TIME_INVALID');return Date.parse(value);}
function expectedSources(season){const root='https://github.com/nflverse/nflverse-data/releases/download/';return [
 ...['passing','rushing','receiving'].map(x=>[root+`nextgen_stats/ngs_${x}.csv.gz`,36]),
 ...[season,season-1].flatMap(y=>[[root+`stats_team/stats_team_week_${y}.csv`,y===season?36:null],[root+`stats_player/stats_player_week_${y}.csv`,y===season?36:null],[root+`snap_counts/snap_counts_${y}.csv`,y===season?96:null]]),
 [root+`pbp/play_by_play_${season}.csv.gz`,36]];}
export async function validateVerifiedNflInput({snapshotText,receipt,schedule,now=Date.now()}){
 if(!Number.isFinite(now)||typeof snapshotText!=='string'||new TextEncoder().encode(snapshotText).length>8*1024*1024)fail('NFL_INPUT_INVALID');
 const season=new Date(now).getUTCMonth()>=7?new Date(now).getUTCFullYear():new Date(now).getUTCFullYear()-1;
 if(receipt?.sport!=='nfl'||receipt.source!=='nflverse'||receipt.season!==season||receipt.snapshotSha256!==await sha(snapshotText))fail('NFL_RECEIPT_HASH_OR_SCOPE');
 const snapshot=JSON.parse(snapshotText),valid=validateNflFeatureSnapshot(snapshot,season,now);
 if(!valid.ok||snapshot.meta.marketInformed!==false)fail('NFL_SNAPSHOT_INVALID');
 const observed=time(receipt.observedAt),through=time(receipt.dataThrough);
 if(observed>now||now-observed>=36*HOUR||valid.builtAt>observed||through>observed||through>valid.builtAt)fail('NFL_SOURCE_TIME_INVALID');
 let expiresAt=Math.min(valid.builtAt+36*HOUR,observed+36*HOUR);
 const sources=receipt.sourceObservations;
 if(!Array.isArray(sources)||sources.length!==10||new Set(sources.map(s=>s.url)).size!==10)fail('NFL_SOURCE_RECEIPTS_INCOMPLETE');
 for(const [url,maxAge] of expectedSources(season)){
  const r=sources.find(s=>s.url===url),at=r&&time(r.observedAt),updated=Date.parse(r?.lastModified);
  expiresAt=Math.min(expiresAt,at+36*HOUR,maxAge===null?Infinity:updated+maxAge*HOUR);
  if(!r||r.status!==200||at>observed||at>now||now-at>=36*HOUR||!Number.isFinite(updated)||updated>at||(maxAge!==null&&now-updated>=maxAge*HOUR))fail('NFL_SOURCE_STALE_OR_MISSING');
 }
 const completed=receipt.completedGameIds;
 if(!Array.isArray(completed)||!completed.length||completed.length>272||new Set(completed).size!==completed.length)fail('NFL_COMPLETED_GAMES_INVALID');
 if(schedule?.season!==season||schedule.source!=='https://github.com/nflverse/nfldata/raw/refs/heads/master/data/games.csv'||!Array.isArray(schedule.games)||schedule.games.length!==272)fail('NFL_SCHEDULE_INCOMPLETE');
 const scheduleAt=time(schedule.observedAt);if(scheduleAt>now||now-scheduleAt>=36*HOUR)fail('NFL_SCHEDULE_STALE');
 const gameMap=new Map(),espn=new Set(),appearances=new Map(),teamWeeks=new Set();
 for(const g of schedule.games){
  const home=canon(g.home),away=canon(g.away);
  if(typeof g.id!=='string'||g.id!==`${season}_${String(g.week).padStart(2,'0')}_${g.away}_${g.home}`||!Number.isInteger(g.week)||g.week<1||g.week>18||!codes.has(home)||!codes.has(away)||home===away||gameMap.has(g.id)||!/^\d+$/.test(g.espnId)||espn.has(g.espnId))fail('NFL_SCHEDULE_IDENTITY');
  for(const t of [home,away]){const key=`${t}:${g.week}`;if(teamWeeks.has(key))fail('NFL_SCHEDULE_DUPLICATE_TEAM_WEEK');teamWeeks.add(key);appearances.set(t,(appearances.get(t)||0)+1);}
  gameMap.set(g.id,{...g,home,away});espn.add(g.espnId);
 }
 if([...codes].some(t=>appearances.get(t)!==17)||completed.some(id=>!gameMap.has(id)))fail('NFL_SCHEDULE_COVERAGE');
 if(completed.some(id=>{const g=gameMap.get(id);return !Number.isFinite(Date.parse(g.start))||Date.parse(g.start)>=through;}))fail('NFL_COMPLETED_GAME_AFTER_SOURCE');
 if(!Number.isInteger(receipt.completedWeek)||receipt.completedWeek<1||receipt.completedWeek>18||[...gameMap.values()].some(g=>g.week<=receipt.completedWeek&&!completed.includes(g.id)))fail('NFL_COMPLETED_WEEK_OVERCLAIM');
 const fields=['offenseEpa','defenseEpa','passEpa','passEpaAllowed','rushEpa','rushEpaAllowed','qbEpa','qbCpoe','successRate','successRateAllowed','earlyDownEpa','earlyDownEpaAllowed','explosiveRate','explosiveRateAllowed'];
 if(Object.keys(snapshot.byTeam).length!==32||[...codes].some(t=>!snapshot.byTeam[t]||!Array.isArray(snapshot.playersByTeam[t])||!snapshot.playersByTeam[t].length||fields.some(f=>!Number.isFinite(snapshot.byTeam[t][f]))))fail('NFL_FEATURE_COVERAGE');
 const eligiblePlayers={},excludedPlayers=[];
 for(const t of codes){
  eligiblePlayers[t]=[];
  const players=snapshot.playersByTeam[t],ids=new Set();
  if(players.length>100)fail('NFL_PLAYER_BOUND');
  for(const p of players){
   if(!p||typeof p!=='object'||Array.isArray(p)||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||typeof p.position!=='string'||!p.position||p.team!==t)fail('NFL_PLAYER_IDENTITY');
   ids.add(p.id);
   for(const f of ['games','snapShare','passing_yards','passing_tds','attempts','completions','interceptions','rushing_yards','rushing_tds','carries','receiving_yards','receiving_tds','targets','receptions','total_tds'])if(p[f]!=null&&(typeof p[f]!=='number'||!Number.isFinite(p[f])))fail('NFL_PLAYER_VALUE');
   for(const group of ['recent5','seasonAvg','priorAvg','sd']){
    if(p[group]==null)continue;
    if(typeof p[group]!=='object'||Array.isArray(p[group]))fail('NFL_PLAYER_NESTED_STATS');
    for(const [field,value] of Object.entries(p[group])){
     if(value==null)continue;
     const minimum=group==='sd'||!field.endsWith('_yards')?0:-100;
     if(typeof value!=='number'||!Number.isFinite(value)||value<minimum||value>1000)fail('NFL_PLAYER_NESTED_STATS');
    }
   }
   if(!Array.isArray(p.recentGames)||!p.recentGames.length||p.recentGames.some(h=>h?.season!==season)){
    excludedPlayers.push({team:t,playerId:p.id,reason:'NO_VERIFIED_CURRENT_SEASON_PLAYER_HISTORY'});continue;
   }
   if(p.recentGames.length>5)fail('NFL_PLAYER_HISTORY');
   const historyKeys=new Set();
   for(const h of p.recentGames){
    const key=`${h.week}:${canon(h.opponent)}`;if(historyKeys.has(key))fail('NFL_PLAYER_DUPLICATE_HISTORY');historyKeys.add(key);
    if(![...gameMap.values()].some(g=>g.week===h.week&&completed.includes(g.id)&&((g.home===t&&g.away===canon(h.opponent))||(g.away===t&&g.home===canon(h.opponent)))))fail('NFL_PLAYER_HISTORY_NOT_COMPLETED');
   }
   eligiblePlayers[t].push(p);
  }
 }
 if(snapshot.meta.currentRows?.team!==completed.length*2)fail('NFL_TEAM_SOURCE_COMPLETENESS_MISMATCH');
 return {snapshot:{...snapshot,playersByTeam:eligiblePlayers},expiresAt:Math.min(expiresAt,scheduleAt+36*HOUR),excludedPlayers,receipt,gameMap,completed:new Set(completed),observed,scheduleAt,season};
}
export async function projectVerifiedNflFutureGames({games=[],publication,schedule,now=Date.now()}){
 if(!Array.isArray(games)||games.length>100)fail('NFL_FIXTURE_BOUND');
 let checked;
 try{
  if(publication?.schema!=='nfl-feature-publication-v1')fail('NFL_PUBLICATION_ENVELOPE');
  checked=await validateVerifiedNflInput({...publication,schedule,now});
 }catch(error){return {games,decisions:games.map(g=>({gameId:String(g?.id),state:'UNCHANGED',reason:String(error.message||error)})),meta:{sport:'nfl',applied:0,providerCalls:0,storageReads:0,storageWrites:0,calibrationVerified:false,canAuthorizeWager:false}};}
 const decisions=[];
 const result=games.map(game=>{
  const hold=reason=>{decisions.push({gameId:String(game?.id),state:'UNCHANGED',reason});return game;};
  if(game?.sport!=='nfl')return hold('NOT_NFL');
  if(game.status!=='scheduled'||!Number.isFinite(Date.parse(game.start))||Date.parse(game.start)<=now)return hold('NOT_FUTURE_SCHEDULED');
  const fixture=[...checked.gameMap.values()].find(g=>g.espnId===String(game.id));
  if(!fixture||Date.parse(fixture.start)!==Date.parse(game.start)||fixture.home!==byEspn.get(String(game.home?.espnId))||fixture.away!==byEspn.get(String(game.away?.espnId))||canon(game.home?.abbr)!==fixture.home||canon(game.away?.abbr)!==fixture.away||typeof game.neutralSite!=='boolean'||game.neutralSite!==fixture.neutralSite)return hold('FIXTURE_IDENTITY_UNVERIFIED');
  if(checked.completed.has(fixture.id)||checked.observed>=Date.parse(game.start)||checked.scheduleAt>=Date.parse(game.start))return hold('POST_START_SOURCE_OR_COMPLETED_GAME');
  const prior=[...checked.gameMap.values()].filter(g=>g.week<fixture.week&&[g.home,g.away].some(t=>t===fixture.home||t===fixture.away));
  if(prior.some(g=>!checked.completed.has(g.id)))return hold('PRIOR_TEAM_GAME_NOT_IN_SOURCE');
  // Existing NFL feature attachment, game scorer, board formatter and player
  // projection consumers. No coefficient changes or college callsites involved.
  try{
  const canonicalGame={...game,home:{...game.home,abbr:fixture.home},away:{...game.away,abbr:fixture.away}};
  const enriched=attachNflVerseFeatures([canonicalGame],checked.snapshot);
  const contextual=enriched.map(g=>attachVerifiedNflScheduleContext(g,checked,now));
  const pro=attachNflProShadow(contextual);
  const board=attachNflGameMatchups(promoteNflResearchToBoard(pro.games).games).games;
  const [out]=attachNflPlayerProjectionResearch(board,{byTeam:checked.snapshot.playersByTeam,leaguePositionDefense:checked.snapshot.leaguePositionDefense,meta:checked.snapshot.meta});
  const projection={...out.nflProShadow,canQualify:false,canAuthorizeWager:false};
  decisions.push({gameId:String(game.id),state:'NFL_RESEARCH_INPUTS_APPLIED',reason:null});
  const heldRows=out.playerProjectionRows.map(r=>({...r,canQualify:false,canAuthorizeWager:false,eligibleForCard:false,propGate:r.propGate==='BLOCKED'?'BLOCKED':'HOLD',gateReason:r.gateReason||'prospective_calibration_required'}));
  return removeAuthority({...out,nflProShadow:projection,challengers:{...out.challengers,[projection.modelId]:projection},
   playerProjectionRows:heldRows,playerProjectionStatus:{...out.playerProjectionStatus,state:heldRows.length?'HOLD_VALIDATION':'PLAYER_DATA_UNAVAILABLE',canQualify:false,canAuthorizeWager:false},
   nflVerifiedInput:{snapshotSha256:checked.receipt.snapshotSha256,observedAt:checked.receipt.observedAt,dataThrough:checked.receipt.dataThrough,fixtureId:fixture.id,source:'nflverse',excludedPriorOnlyPlayers:checked.excludedPlayers.length,historicalAsOfSafe:false,canAuthorizeWager:false},canQualify:false,canAuthorizeWager:false});
  }catch(error){
   // Existing fallback stays unchanged even if a downstream model rejects input.
   if(decisions.at(-1)?.gameId===String(game.id))decisions.pop();
   return hold('NFL_CONSUMER_REJECTED_INPUT');
  }
 });
 return {games:result,decisions,meta:{sport:'nfl',source:'nflverse',applied:decisions.filter(d=>d.state==='NFL_RESEARCH_INPUTS_APPLIED').length,sourceExpiresAt:new Date(checked.expiresAt).toISOString(),providerCalls:0,storageReads:0,storageWrites:0,calibrationVerified:false,canAuthorizeWager:false}};
}

function removeAuthority(value){
 const result=structuredClone(value),keys=new Set(['canAuthorize','canAuthorizeWager','canQualify','decisionEligible','qualificationAllowed','canShowCalibratedEv','eligibleForCard']);
 const visit=x=>{if(!x||typeof x!=='object')return;for(const k of Object.keys(x)){if(keys.has(k))x[k]=false;else visit(x[k]);}};
 visit(result);return result;
}
