// Research-only, pre-season frozen lower-tier -> main-tour match winner replay.
// No market data, no live projection reads, no writes, no bet authorization.
// Uses FBIS TENNIS-FBIS-v1 match Monte Carlo as a comparative engine; NOT a
// qualification of TENNIS-FBIS-v2-CONTEXT or its production features.
import {simulateTennisMatch} from '../../functions/lib/tennisFbisV1.js';
import {tierOf,runCrossLevelEvaluation} from './tennis-crosslevel-walkforward.mjs';
import {sourceSurface} from './tennis-lowtier-source-audit.mjs';

const NOMINAL_SIMULATIONS=300;
const neutral={atp:{serve:.635,ret:.365,ace:.075,df:.035},
 wta:{serve:.59,ret:.41,ace:.045,df:.045}};
const clip=(v,low=.01,high=.99)=>Math.max(low,Math.min(high,v));
const total=arr=>arr.reduce((a,b)=>a+b,0);
const mean=arr=>arr.length?total(arr)/arr.length:null;
const hash=s=>{let h=2166136261;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
const scoreComplete=value=>{
 const s=String(value||'').trim();
 if(!s||/\b(?:RET|W\/O|WO|DEF|ABD|CANCELLED|UNFINISHED|DEFAULT)\b/i.test(s))return false;
 return s.split(/\s+/).filter(part=>/^\d+-\d+(?:\([^)]*\))?$/.test(part)).length>=2;
};
const bucketKey=(tour,year,tier,surface)=>[tour,year,tier,surface].join('|');
const zero=()=>({matches:0,svpt:0,serveWon:0,returnPts:0,returnWon:0});
const merged=(to,from)=>{for(const k of ['matches','svpt','serveWon','returnPts','returnWon'])to[k]+=from[k]};
const ratio=(p,n,d)=>p[n]/p[d];
function collectTraining(store,tour,tier,surface,lastYear){
 const byPlayer=new Map();
 for(let year=2024;year<=lastYear;year++){
  for(const [id,stats] of store.groups.get(bucketKey(tour,year,tier,surface))||[]){
   if(!byPlayer.has(id))byPlayer.set(id,zero());
   merged(byPlayer.get(id),stats);
  }
 }
 return byPlayer;
}
function tierPriority(tier){
 // Explicit source hierarchy, determined without holdout outcomes.
 if(tier.startsWith('ATP_QUAL_CHALL:'))return 1;
 if(tier.startsWith('WTA_QUAL_ITF:'))return 1;
 if(tier.startsWith('ATP_FUTURES:'))return 2;
 return 9;
}
function chooseTrainingProfile(byTier,id,tour,surface,folds,year,minimumMatches,minimumPoints){
 const choices=[];
 for(const [tier,profiles] of byTier){
  const p=profiles.get(id);
  if(!p||p.matches<minimumMatches||p.svpt<minimumPoints||p.returnPts<minimumPoints)continue;
  const adjustment=(metric)=>folds.get([tour,tier,surface,year,metric].join('|'))?.calibration;
  const serve=adjustment('serve'),ret=adjustment('return');
  // No silent per-player adjustment from non-eligible overlapping cohorts.
  if(!serve?.eligible||!ret?.eligible||serve.delta==null||ret.delta==null)continue;
  choices.push({tier,profile:p,serveDelta:serve.delta,returnDelta:ret.delta});
 }
 choices.sort((a,b)=>tierPriority(a.tier)-tierPriority(b.tier)||
   b.profile.matches-a.profile.matches||a.tier.localeCompare(b.tier));
 return choices[0]||null;
}
function profileFor(id,surface,choice,tour,adjusted){
 const p=choice.profile,prior=neutral[tour],n=p.svpt,r=p.returnPts;
 const serve=clip(p.serveWon/n+(adjusted?choice.serveDelta:0),.3,.85);
 const ret=clip(p.returnWon/r+(adjusted?choice.returnDelta:0),.15,.7);
 return {id,surfaceElo:{[surface]:1500},elo:1500,
  servePointWinPct:serve,returnPointWinPct:ret,
  aceRate:prior.ace,doubleFaultRate:prior.df};
}
export function sanitizeMainTourHoldout(meta,rows,{cutoffExclusive='99999999'}={}){
 if(meta.sourceTier!=='MAIN_TOUR')return [];
 const out=[],seen=new Set();
 for(const r of rows){
  const date=String(r.tourney_date||'');
  if(!/^20(?:25|26)\d{4}$/.test(date)||date>=cutoffExclusive)continue;
  const surface=sourceSurface(r.surface);
  if(!surface||!r.winner_id||!r.loser_id||r.winner_id===r.loser_id)continue;
  if(Number(r.best_of)!==3||!scoreComplete(r.score))continue;
  const tier=tierOf(meta,r);
  if(tier!=='MAIN_TOUR')continue;
  const key=[meta.tour,date,r.tourney_id,r.match_num,
   ...[String(r.winner_id),String(r.loser_id)].sort()].join('|');
  if(seen.has(key))continue;
  seen.add(key);
  const alternate=hash(key)%2===1;
  out.push({key,year:Number(date.slice(0,4)),tour:meta.tour,date,
   tournament:[meta.tour,r.tourney_id||r.tourney_name,date].join('|'),
   surface,player1:alternate?String(r.loser_id):String(r.winner_id),
   player2:alternate?String(r.winner_id):String(r.loser_id),
   outcomeP1:alternate?0:1, bestOf:3});
 }
 return out;
}
const score=(p,y)=>({
 brier:(p-y)**2,logLoss:-(y*Math.log(clip(p,1e-6,1-1e-6))+
  (1-y)*Math.log(clip(1-p,1e-6,1-1e-6))),
 correct:Number((p>=.5?1:0)===y)
});
function summarize(rows){
 const n=rows.length;
 if(!n)return {matches:0,raw:null,adjusted:null,difference:null,improved:null};
 const outcome={};
 for(const variant of ['raw','adjusted']){
  outcome[variant]={
   brier:mean(rows.map(x=>x[variant].brier)),
   logLoss:mean(rows.map(x=>x[variant].logLoss)),
   winnerAccuracy:mean(rows.map(x=>x[variant].correct))
  };
 }
 return {matches:n,raw:outcome.raw,adjusted:outcome.adjusted,
  difference:{brier:outcome.raw.brier-outcome.adjusted.brier,
   logLoss:outcome.raw.logLoss-outcome.adjusted.logLoss,
   winnerAccuracy:outcome.adjusted.winnerAccuracy-outcome.raw.winnerAccuracy},
  improved:outcome.adjusted.brier<outcome.raw.brier};
}
function clusterInterval(rows,iterations=500){
 // Fixed-seed cluster bootstrap: tournaments, not matches, are resampled.
 const groups=new Map();
 for(const row of rows){
  if(!groups.has(row.tournament))groups.set(row.tournament,[]);
  groups.get(row.tournament).push(row);
 }
 const blocks=[...groups.values()];
 if(blocks.length<20)return {eligible:false,blocks:blocks.length,
  reason:'INSUFFICIENT_TOURNAMENT_CLUSTERS'};
 let state=0x498c2f1;const R=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296};
 const values=[];
 for(let i=0;i<iterations;i++){
  let sum=0,n=0;
  for(let j=0;j<blocks.length;j++){
   const block=blocks[Math.floor(R()*blocks.length)];
   for(const r of block){sum+=r.raw.brier-r.adjusted.brier;n++}
  }
  values.push(sum/n);
 }
 values.sort((a,b)=>a-b);
 return {eligible:true,blocks:blocks.length,iterations,
  low95:values[Math.floor(iterations*.025)],
  high95:values[Math.floor(iterations*.975)],
  excludesZero:values[Math.floor(iterations*.025)]>0||
    values[Math.floor(iterations*.975)]<0};
}
export function evaluateMatchWinnerTransfer(store,holdoutMatches,options={}){
 const policy={minMatches:3,minPoints:100,minPairedMatches:75,
  minTournamentClusters:20,simulations:NOMINAL_SIMULATIONS,...options};
 const calibration=runCrossLevelEvaluation(store);
 const folds=new Map(calibration.findings.map(x=>[
  [x.tour,x.tier,x.surface,x.holdoutYear,x.metric].join('|'),x]));
 const byTourYearSurface=new Map();
 for(const [key] of store.groups){
  const [tour,,tier,surface]=key.split('|');
  if(tier==='MAIN_TOUR')continue;
  for(const year of [2025,2026]){
   const key2=[tour,year,surface].join('|');
   if(!byTourYearSurface.has(key2))byTourYearSurface.set(key2,new Set());
   byTourYearSurface.get(key2).add(tier);
  }
 }
 const prepared=new Map();
 for(const [key,tiers] of byTourYearSurface){
  const [tour,yearStr,surface]=key.split('|'),year=Number(yearStr);
  const map=new Map();
  for(const tier of tiers)map.set(tier,collectTraining(store,tour,tier,surface,year-1));
  prepared.set(key,map);
 }
 const cases=[],rejected={};
 const drop=reason=>{rejected[reason]=(rejected[reason]||0)+1};
 for(const event of holdoutMatches){
  const {tour,year,surface}=event;
  if(year!==2025&&year!==2026){drop('NOT_HELDOUT_YEAR');continue}
  const byTier=prepared.get([tour,year,surface].join('|'));
  if(!byTier){drop('NO_PRIOR_TIER_HISTORY');continue}
  const p1=chooseTrainingProfile(byTier,event.player1,tour,surface,folds,year,policy.minMatches,policy.minPoints);
  const p2=chooseTrainingProfile(byTier,event.player2,tour,surface,folds,year,policy.minMatches,policy.minPoints);
  if(!p1||!p2){drop('NO_BOTH_PLAYER_QUALIFIED_PRIOR_TIER_PROFILE');continue}
  const game=(adjusted)=>({id:event.key,surface,bestOf:3,
   player1:profileFor(event.player1,surface,p1,tour,adjusted),
   player2:profileFor(event.player2,surface,p2,tour,adjusted)});
  const params={researchBacktest:true,simulations:policy.simulations,seed:event.key};
  // Identical RNG stream for paired A/B variance reduction.
  const a=simulateTennisMatch(game(false),{},params).match.pPlayer1Win;
  const b=simulateTennisMatch(game(true),{},params).match.pPlayer1Win;
  if(!Number.isFinite(a)||!Number.isFinite(b)){drop('INVALID_SIMULATOR_PROBABILITY');continue}
  cases.push({...event,sourceTiers:[p1.tier,p2.tier],
   rawProbability:a,adjustedProbability:b,
   raw:score(a,event.outcomeP1),adjusted:score(b,event.outcomeP1)});
 }
 const partitions=[];
 for(const tour of ['atp','wta'])for(const year of [2025,2026]){
  const rows=cases.filter(r=>r.tour===tour&&r.year===year);
  const metrics=summarize(rows),uncertainty=clusterInterval(rows);
  partitions.push({tour,holdoutYear:year,...metrics,
   uncertainty,statisticallyEvaluable:rows.length>=policy.minPairedMatches&&
    uncertainty.blocks>=policy.minTournamentClusters,
   productionQualifiable:false});
 }
 const overall=summarize(cases),ci=clusterInterval(cases);
 return {asOf:new Date().toISOString(),
  model:'TENNIS-FBIS-v1 RESEARCH point/game/set simulator paired comparison; not v2 CORE',
  approach:'Prior-calendar-year lower-tier player evidence + previous-years-only fitted tier offsets',
  independentOfMarkets:true,sources:'Sackmann/Tennis Abstract, CC BY-NC-SA 4.0',
  sourceRights:'PRIVATE_NONCOMMERCIAL_RESEARCH_ONLY',
  limitations:['Tournament dates are start dates, not match-level timestamps',
    'Training-era source mirrors were downloaded retrospectively, not independently archived as-of',
    'Tournament-cluster bootstrap does not prove profitability or eliminate all selection bias',
    'Only events with two prior lower-tier profiles and valid adjustment overlap enter paired comparison',
    'Fixed neutral Elo and observed priors isolate point-rate effects; this is not the full v2 context model'],
  policy,holdoutMatchCandidates:holdoutMatches.length,pairedMatches:cases.length,
  unscoredReasonCounts:rejected,overall,overallCluster95:ci,partitions,
  effectDirection:overall.improved?'ADJUSTMENT_IMPROVED_PAIRED_BRIER':'NO_PAIRED_BRIER_IMPROVEMENT',
  researchOnly:true,canQualify:false,canAuthorizeWager:false,productionWrites:0,
  rowSamples:cases.slice(0,25).map(x=>({
   event:x.key,year:x.year,tour:x.tour,surface:x.surface,
   sourceTiers:x.sourceTiers,rawProbability:x.rawProbability,adjustedProbability:x.adjustedProbability,
   outcomeP1:x.outcomeP1}))
 };
}
