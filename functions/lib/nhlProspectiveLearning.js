import {readPropEvidence} from './propEvidenceStore.js';
const FROZEN='player-props/evidence/v1/prospective-index.json';
const OUTCOME='player-props/official/v1/nhl-outcome-index.json';
const REPORT='player-props/learning/v1/nhl-projection-accuracy.json';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const time=x=>Date.parse(x);
export function evaluateNhlProspectivePair(prediction,result,{now=Date.now()}={}){
 const block=reason=>({ok:false,reason});
 if(!prediction||!result||prediction.independent!==true||!prediction.modelVersion||
    prediction.period!=='full_game'||result.period!=='full_game'||
    prediction.canonicalEventId!==result.canonicalEventId||
    prediction.canonicalPlayerId!==result.canonicalPlayerId||
    prediction.canonical_market!==result.canonical_market)return block('MODEL_RESULT_SCOPE_MISMATCH');
 if(result.source!=='NHL_GAMECENTER_BOXSCORE'||result.official!==true||
    result.status!=='FINAL'||result.playerStatus!=='PLAYED'||result.correctionPending===true)
  return block('OFFICIAL_FINAL_RESULT_REQUIRED');
 if(!finite(prediction.projection)||!finite(result.actual)||result.actual<0)
  return block('NUMERIC_PROJECTION_AND_STAT_REQUIRED');
 const frozen=time(prediction.frozenAt),asOf=time(prediction.modelAsOf||prediction.asOf),
  start=time(prediction.eventStart),observedFinal=time(result.finalizedAt);
 if(![frozen,asOf,start,observedFinal].every(Number.isFinite)||
    asOf>frozen||frozen>=start||observedFinal<start||observedFinal>now)
  return block('TEMPORAL_EVIDENCE_INVALID');
 const error=prediction.projection-result.actual;
 return {ok:true,error,absoluteError:Math.abs(error),squaredError:error*error,
  modelVersion:prediction.modelVersion,market:prediction.canonical_market,
  eventId:prediction.canonicalEventId,playerId:prediction.canonicalPlayerId};
}
export async function computeNhlProspectiveLearning(env,{now=new Date(),webCrypto=globalThis.crypto}={}){
 if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)return {ok:false,reason:'ARCHIVE_UNBOUND'};
 let frozenIndex,outcomeIndex;
 try{
  const [f,o]=await Promise.all([env.ARCHIVE.get(FROZEN),env.ARCHIVE.get(OUTCOME)]);
  frozenIndex=f?await f.json():null;outcomeIndex=o?await o.json():null;
 }catch{return {ok:false,reason:'EVIDENCE_INDEX_READ_FAILED'};}
 if(frozenIndex&& (frozenIndex.version!==1||!Array.isArray(frozenIndex.entries)))
  return {ok:false,reason:'PROJECTION_INDEX_INVALID'};
 if(outcomeIndex && (typeof outcomeIndex!=='object'||Array.isArray(outcomeIndex)))
  return {ok:false,reason:'OUTCOME_INDEX_INVALID'};
 const candidates=(frozenIndex?.entries||[]).filter(e=>e.kind==='FROZEN_PROJECTION');
 const latest=new Map();
 for(const e of candidates){
  const key=[e.canonicalEventId,e.canonicalPlayerId,e.market,e.modelVersion].join('|');
  const earlier=latest.get(key);
  if(!earlier||time(e.asOf)>time(earlier.asOf))latest.set(key,e);
 }
 const groups=new Map(),receipts=[];
 for(const e of [...latest.values()].slice(-256)){
  const resultKey=[e.canonicalEventId,e.canonicalPlayerId,e.market].join('|');
  const output=outcomeIndex?.[resultKey];
  if(!output?.id){receipts.push({state:'RESULT_PENDING'});continue;}
  const [f,o]=await Promise.all([
   readPropEvidence(env,'FROZEN_PROJECTION',e.id,{webCrypto}),
   readPropEvidence(env,'OFFICIAL_RESULT',output.id,{webCrypto})
  ]);
  if(!f.ok||!o.ok){receipts.push({state:'CONTENT_INTEGRITY_UNVERIFIED'});continue;}
  const assessed=evaluateNhlProspectivePair(f.payload.prediction,o.payload.result,{now:now.getTime()});
  if(!assessed.ok){receipts.push({state:assessed.reason});continue;}
  const groupKey=assessed.modelVersion+'|'+assessed.market;
  const g=groups.get(groupKey)||{modelVersion:assessed.modelVersion,market:assessed.market,n:0,abs:0,squared:0,bias:0};
  g.n++;g.abs+=assessed.absoluteError;g.squared+=assessed.squaredError;g.bias+=assessed.error;
  groups.set(groupKey,g);receipts.push({state:'VERIFIED_PAIR'});
 }
 const cohorts=[...groups.values()].map(g=>({modelVersion:g.modelVersion,market:g.market,n:g.n,
  mae:g.abs/g.n,rmse:Math.sqrt(g.squared/g.n),meanError:g.bias/g.n}));
 const report={version:1,asOf:now.toISOString(),status:cohorts.length?'OFFICIAL_PROJECTION_ERRORS':'NO_VERIFIED_PAIRS',
  frozenModelScopes:latest.size,verifiedPairs:receipts.filter(r=>r.state==='VERIFIED_PAIR').length,
  pendingResults:receipts.filter(r=>r.state==='RESULT_PENDING').length,
  rejected:receipts.filter(r=>!['VERIFIED_PAIR','RESULT_PENDING'].includes(r.state)).length,
  cohorts,scope:'PROJECTION_ERROR_ONLY',calibration:null,clv:null,realizedProfit:null,
  verifiedEconomicEdge:false,canQualify:false,canAuthorizeWager:false};
 try{await env.ARCHIVE.put(REPORT,JSON.stringify(report),{httpMetadata:{contentType:'application/json'}});}
 catch{return {ok:false,reason:'LEARNING_REPORT_WRITE_FAILED'};}
 return {ok:true,...report};
}
