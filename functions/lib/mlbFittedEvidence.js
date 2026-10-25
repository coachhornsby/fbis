import {sha256Hex} from './sha256Hex.js';
import {normalizeMlbGameFeed} from './mlbGameIntelligence.js';
export async function persistFittedFreeze(env,game,date,now=new Date().toISOString()){
 const shadow=game.mlbFittedShadow;
 if(!shadow?.available)return {gameId:String(game.id),skipped:shadow?.reason||'FITTED_MODEL_UNAVAILABLE'};
 if(!/^\d+$/.test(String(game.id))||Date.parse(now)>=Date.parse(game.start)||Date.parse(shadow.capturedAt)>Date.parse(now)||Date.parse(shadow.observedAt)>Date.parse(shadow.capturedAt))throw Error('FITTED_CAPTURE_TIME_INVALID');
 const minutes=(Date.parse(game.start)-Date.parse(now))/60000,checkpoint=minutes<=15?'T15':minutes<=60?'T60':'EARLY';
 const data={...shadow,gameId:String(game.id),checkpoint,capturedAt:now,classification:'PROSPECTIVE',scope:game.mlbContext?.postseason?'postseason':'regular',lineupsOfficial:game.bpp?.lineupsOfficial===true};
 const freeze={...data,sourceHash:sha256Hex(JSON.stringify(data))},key=`models/mlb/fitted/v1/forecasts/${date}/${game.id}/${checkpoint}.json`;
 await env.ARCHIVE.put(key,JSON.stringify(freeze),{onlyIf:new Headers({'If-None-Match':'*'})});
 const saved=await (await env.ARCHIVE.get(key)).json();return {gameId:saved.gameId,checkpoint:saved.checkpoint,sourceHash:saved.sourceHash,capturedAt:saved.capturedAt,forecasts:saved.forecasts.length};
}
export function gradeFittedFreeze(freeze,feed){
 const {sourceHash,...data}=freeze;if(sha256Hex(JSON.stringify(data))!==sourceHash)throw Error('FITTED_FREEZE_HASH_MISMATCH');
 if(Date.parse(freeze.capturedAt)>=Date.parse(freeze.gameStart)||freeze.classification!=='PROSPECTIVE')throw Error('FITTED_FREEZE_NOT_PREGAME');
 const finalHash=sha256Hex(JSON.stringify({gameData:feed.gameData,liveData:feed.liveData})),final=normalizeMlbGameFeed(feed,{sourceHash:finalHash});if(final.gameId!==freeze.gameId)throw Error('FITTED_GRADE_IDENTITY');
 const targets=[];for(const p of freeze.forecasts){const role=p.market==='pitcher_k'?'pitching':'batting',actualPlayer=final.players.find(x=>x.playerId===p.playerId&&x.group===role&&(role!=='pitching'||x.starter));if(!actualPlayer)continue;
  let actual=actualPlayer.stats[{pitcher_k:'strikeOuts',hits:'hits',total_bases:'totalBases',home_runs:'homeRuns'}[p.market]];
  if(p.market==='total_bases'&&actual==null){const s=actualPlayer.stats;if([s.hits,s.doubles,s.triples,s.homeRuns].every(Number.isFinite))actual=s.hits+s.doubles+2*s.triples+3*s.homeRuns;}
  if(Number.isFinite(actual))targets.push({...p,actual});
 }
 return {version:'mlb-fitted-grades-v1',gameId:freeze.gameId,date:freeze.officialDate,checkpoint:freeze.checkpoint,scope:freeze.scope,capturedAt:freeze.capturedAt,settledAt:new Date().toISOString(),freezeHash:sourceHash,finalHash,classification:'PROSPECTIVE',targets,canPromote:false};
}
export function summarizeFittedGrades(grades){
 const groups=new Map(),seen=new Set();for(const g of grades){const key=g.gameId+':'+g.checkpoint;if(seen.has(key))throw Error('DUPLICATE_FITTED_GRADE');seen.add(key);
  for(const t of g.targets){const cohort=[t.market,t.modelHash,g.scope,g.checkpoint].join(':');if(!groups.has(cohort))groups.set(cohort,[]);groups.get(cohort).push({...t,date:g.date,gameId:g.gameId});}
 }
 return {cohorts:[...groups].map(([cohort,rs])=>{const paired=rs.filter(r=>Number.isFinite(r.championProjection));return {cohort,n:rs.length,distinctGames:new Set(rs.map(r=>r.gameId)).size,distinctDates:new Set(rs.map(r=>r.date)).size,mae:rs.reduce((s,r)=>s+Math.abs(r.projection-r.actual),0)/rs.length,pairedN:paired.length,pairedChampionMae:paired.length?paired.reduce((s,r)=>s+Math.abs(r.championProjection-r.actual),0)/paired.length:null,pairedCandidateMae:paired.length?paired.reduce((s,r)=>s+Math.abs(r.projection-r.actual),0)/paired.length:null};}),canPromote:false,reason:'EXISTING_MARKET_SPECIFIC_PROMOTION_GATES_REQUIRE_LIVE_AND_EXACT_LINE_EVIDENCE'};
}
