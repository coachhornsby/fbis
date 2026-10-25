import {projectMlbDeep,MLB_DEEP_VERSION} from './mlbDeepModel.js';
import {validatePregameSnapshot} from './mlbModelFeatures.js';
import {normalizeMlbGameFeed} from './mlbGameIntelligence.js';
import {sha256Hex} from './sha256Hex.js';
export const MLB_COMPLETION_VERSION='mlb-completion-v1';
export const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
export async function gzipEvidence(data){return new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();}
export async function gunzipEvidence(object){return new Response(object.body.pipeThrough(new DecompressionStream('gzip'))).json();}
export function buildMlbAblationFreeze(game,capturedAt=new Date().toISOString()){
 if(!/^\d+$/.test(String(game.id))||!Number.isFinite(Date.parse(capturedAt))||!Number.isFinite(Date.parse(game.start))||Date.parse(capturedAt)>=Date.parse(game.start))throw Error('PREGAME_IDENTITY_AND_TIME_REQUIRED');
 const ctx=game.mlbContext||{},neutral={...ctx};
 validatePregameSnapshot({game_time:game.start},{
  context:ctx,statcast:game.mlbPitchMatchup||null,persistent:game.mlbPersistentState||null,
  savant:game.savant||null,teams:{home:game.home||null,away:game.away||null},
  starters:{home:game.homeSp||null,away:game.awaySp||null},
  playerForecasts:game.playerProjectionRows||[]
 },capturedAt);
 const availableTimes=[ctx.palAsOf,game.mlbPersistentState?.asOf,...['homeOffense','awayOffense'].flatMap(side=>(game.mlbPitchMatchup?.[side]?.featureEvidence||[]).flatMap(e=>[e.capturedAt,...(e.sources||[]).map(s=>s.observedAt)]))].filter(Boolean);
 if(availableTimes.some(t=>!Number.isFinite(Date.parse(t))||Date.parse(t)>Date.parse(capturedAt)))throw Error('SOURCE_NOT_AVAILABLE_AT_CAPTURE');
 for(const key of ['palParkRunFactor','palParkHrFactor','homePalRcVsTypical','homePalHrVsTypical','homePalKVsTypical','homePalMatchupN','awayPalRcVsTypical','awayPalHrVsTypical','awayPalKVsTypical','awayPalMatchupN'])neutral[key]=null;
 const inputs={savant:game.savant||{},mlbContext:ctx,mlbPitchMatchup:game.mlbPitchMatchup||null,homeSp:game.homeSp,awaySp:game.awaySp,home:game.home,away:game.away};
 const variants={baseline:{...game,mlbContext:neutral,mlbPitchMatchup:null},statcast:{...game,mlbContext:neutral},pal:{...game,mlbPitchMatchup:null},combined:game};
 const predictions=Object.fromEntries(Object.entries(variants).map(([name,g])=>{const p=projectMlbDeep(g);return[name,{available:p.ok===true,version:p.version,home:p.home??null,away:p.away??null,total:p.total??null,f5:p.f5||null,pitcherKs:p.pitcherKs||null}];}));
 if(!predictions.combined.available)throw Error('PRODUCTION_PROJECTION_UNAVAILABLE');
 const minutes=(Date.parse(game.start)-Date.parse(capturedAt))/60000,checkpoint=minutes<=15?'T15':minutes<=60?'T60':'EARLY';
 const playerForecasts=(game.playerProjectionRows||[]).filter(p=>['hits','total_bases','home_runs','strikeouts'].includes(p.market)&&Number.isFinite(p.fbisProjection??p.projection)).map(p=>({playerId:String(p.playerId),position:p.position,market:p.market,projection:p.fbisProjection??p.projection,modelVersion:p.modelVersion||MLB_DEEP_VERSION,sourceObservedAt:p.sourceObservedAt||null,lineupState:p.lineupState||null}));
 if(playerForecasts.some(p=>p.sourceObservedAt&&(!Number.isFinite(Date.parse(p.sourceObservedAt))||Date.parse(p.sourceObservedAt)>Date.parse(capturedAt))))throw Error('PLAYER_SOURCE_NOT_AVAILABLE_AT_CAPTURE');
 const evidence={version:MLB_COMPLETION_VERSION,playerForecasts,modelVersion:MLB_DEEP_VERSION,gameId:String(game.id),gameStart:game.start,capturedAt,checkpoint,scope:game.mlbContext?.postseason?'postseason':'regular',inputs,predictions,externalPalKs:{home:ctx.homePalStarterProjectedKs??null,away:ctx.awayPalStarterProjectedKs??null},lineupsOfficial:ctx.palLineupsOfficial===true,classification:'PROSPECTIVE',canPromote:false};
 return {...evidence,sourceHash:sha256Hex(JSON.stringify(evidence))};
}
export async function persistMlbAblationFreeze(env,game,date,capturedAt){
 if(!validDay(date))throw Error('INVALID_DATE');
 const freeze=buildMlbAblationFreeze(game,capturedAt),key=`models/mlb/evaluation/v1/${date}/${freeze.gameId}/${freeze.checkpoint}.json`;
 const written=await env.ARCHIVE.put(key,JSON.stringify(freeze),{httpMetadata:{contentType:'application/json'},onlyIf:new Headers({'If-None-Match':'*'})});
 const original=await env.ARCHIVE.get(key);if(!original)throw Error('FREEZE_READBACK_FAILED');const saved=await original.json();
 return {gameId:freeze.gameId,checkpoint:freeze.checkpoint,key,reused:written===null,capturedAt:saved.capturedAt,sourceHash:saved.sourceHash};
}
export async function archiveMlbFinalGame(env,feed,observedAt=new Date().toISOString()){
 const sourceHash=sha256Hex(JSON.stringify({gameData:feed.gameData,liveData:feed.liveData}));
 const normalized=normalizeMlbGameFeed(feed,{sourceHash,observedAt});
 const prefix=`models/mlb/intelligence/games/${normalized.gameId}/${sourceHash}`;
 const existing=await env.ARCHIVE.get(prefix+'/normalized.json.gz');
 if(!existing){
  await env.ARCHIVE.put(prefix+'/raw.json.gz',await gzipEvidence(feed),{onlyIf:new Headers({'If-None-Match':'*'})});
  await env.ARCHIVE.put(prefix+'/normalized.json.gz',await gzipEvidence(normalized),{onlyIf:new Headers({'If-None-Match':'*'})});
 }
 const object=await env.ARCHIVE.get(prefix+'/normalized.json.gz');if(!object)throw Error('FINAL_ARCHIVE_READBACK_FAILED');
 const saved=await gunzipEvidence(object);if(saved.gameId!==normalized.gameId||saved.sourceHash!==sourceHash)throw Error('FINAL_ARCHIVE_IDENTITY_FAILED');
 const receipt={gameId:normalized.gameId,date:normalized.officialDate,sourceHash,key:prefix+'/normalized.json.gz',players:saved.players.length,pitches:saved.pitches.length,observedAt:saved.observedAt,reused:!!existing,indexedInD1:false};
 await env.ARCHIVE.put(`models/mlb/intelligence/receipts/v1/${receipt.date}/${receipt.gameId}.json`,JSON.stringify(receipt));return receipt;
}
export function gradeMlbAblations(freeze,feed){
 const {sourceHash:freezeHash,...original}=freeze;if(sha256Hex(JSON.stringify(original))!==freezeHash)throw Error('FREEZE_HASH_MISMATCH');
 const hash=sha256Hex(JSON.stringify({gameData:feed.gameData,liveData:feed.liveData})),final=normalizeMlbGameFeed(feed,{sourceHash:hash});
 if(final.gameId!==freeze.gameId||Date.parse(freeze.capturedAt)>=Date.parse(freeze.gameStart))throw Error('GRADE_IDENTITY_OR_TIME_FAILED');
 const targets=[];
 for(const side of ['home','away']){
  const pid=String(freeze.inputs[side+'Sp']?.id||'');
  const p=final.players.find(p=>p.playerId===pid&&p.group==='pitching'&&p.starter);
  const k=p?.stats?.strikeOuts;
  if(typeof k!=='number'||!Number.isFinite(k))continue;
  const forecasts=Object.fromEntries(Object.entries(freeze.predictions).map(([name,p])=>[name,p.pitcherKs?.[side]?.projection??null]));
  if(Object.values(forecasts).some(v=>typeof v!=='number'||!Number.isFinite(v)))continue;
  targets.push({market:'pitcher_strikeouts',playerId:pid,actual:k,forecasts});
 }
 const score=feed.liveData?.linescore?.teams;
 for(const side of ['home','away'])if(Number.isFinite(score?.[side]?.runs))targets.push({market:side+'_runs',actual:score[side].runs,forecasts:Object.fromEntries(Object.entries(freeze.predictions).map(([name,p])=>[name,p[side]]))});
 const productionPlayerTargets=[];for(const prediction of freeze.playerForecasts||[]){if(prediction.position==='P')continue;const p=final.players.find(p=>p.playerId===prediction.playerId&&p.group==='batting');if(!p)continue;let actual=p.stats[{hits:'hits',total_bases:'totalBases',home_runs:'homeRuns',strikeouts:'strikeOuts'}[prediction.market]];if(prediction.market==='total_bases'&&actual==null){const {hits,doubles,triples,homeRuns}=p.stats;if([hits,doubles,triples,homeRuns].every(Number.isFinite))actual=hits+doubles+2*triples+3*homeRuns;}if(Number.isFinite(actual))productionPlayerTargets.push({...prediction,actual});}
 return {version:MLB_COMPLETION_VERSION,productionPlayerTargets,modelVersion:freeze.modelVersion,gameId:freeze.gameId,checkpoint:freeze.checkpoint,scope:freeze.scope,capturedAt:freeze.capturedAt,settledAt:new Date().toISOString(),freezeHash:freeze.sourceHash,finalSourceHash:hash,targets,canPromote:false,classification:'PROSPECTIVE',missingPitcherTargets:2-targets.filter(t=>t.market==='pitcher_strikeouts').length};
}
export function summarizeMlbAblations(grades){
 const groups=new Map(),players=new Map(),seen=new Set();
 for(const grade of grades){const key=grade.gameId+':'+grade.checkpoint;if(seen.has(key))throw Error('DUPLICATE_GRADE');seen.add(key);for(const t of grade.productionPlayerTargets||[]){const cohort=[grade.scope,grade.checkpoint,t.market,t.modelVersion].join(':');if(!players.has(cohort))players.set(cohort,[]);players.get(cohort).push({gameId:grade.gameId,...t});}
  for(const t of grade.targets){if(!Number.isFinite(t.actual)||Object.values(t.forecasts).some(v=>!Number.isFinite(v)))continue;
   const cohort=[grade.scope,grade.checkpoint,t.market,grade.modelVersion||'legacy'].join(':');if(!groups.has(cohort))groups.set(cohort,[]);groups.get(cohort).push({gameId:grade.gameId,...t});
  }
 }
 return {version:MLB_COMPLETION_VERSION,productionPlayerCohorts:[...players].map(([cohort,rows])=>({cohort,n:rows.length,distinctGames:new Set(rows.map(r=>r.gameId)).size,mae:rows.reduce((s,r)=>s+Math.abs(r.projection-r.actual),0)/rows.length,bias:rows.reduce((s,r)=>s+r.projection-r.actual,0)/rows.length})),cohorts:[...groups].map(([cohort,rows])=>({cohort,n:rows.length,distinctGames:new Set(rows.map(r=>r.gameId)).size,variants:Object.fromEntries(['baseline','statcast','pal','combined'].map(v=>[v,{mae:rows.reduce((s,r)=>s+Math.abs(r.forecasts[v]-r.actual),0)/rows.length,bias:rows.reduce((s,r)=>s+r.forecasts[v]-r.actual,0)/rows.length}]))})),canPromote:false,profitability:null,limitations:['Forecast counts do not establish exchange profitability.','Variants share games; repeated checkpoints and players are not independent games.','The Pal K ablation can match baseline because the existing K engine uses Pal projections only for external comparison.']};
}
