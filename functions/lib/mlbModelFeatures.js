/** Point-in-time feature evidence. No market inputs or projection authority. */
import {buildMlbStatcastLab,MLB_STATCAST_LAB_CALC_VERSION} from './mlbStatcastLab.js';
import {sha256Hex} from './sha256Hex.js';
export const MLB_FEATURE_VERSION='mlb-statcast-features-v1';
const stamp=s=>typeof s==='string'&&/T.*Z$/.test(s)&&Number.isFinite(Date.parse(s));

// Source availability is bounded by the exact prediction freeze, not merely first pitch.
// Scan nested evidence without treating game dates, kickoff or predicted times as source receipts.
const MLB_PIT_SOURCE_TIMES=new Set([
 'observedAt','observation_timestamp','observationTimestamp','sourceObservedAt',
 'source_timestamp','sourceTimestamp','acquiredAt','acquisition_timestamp',
 'acquisitionTimestamp','collectedAt','capturedAt','featureCapturedAt'
]);
export function validatePregameSnapshot(fixture,features,maxObservationTime){
 const gameStart=fixture?.game_time??fixture?.start;
 if(!stamp(gameStart)||!stamp(maxObservationTime)||Date.parse(maxObservationTime)>=Date.parse(gameStart))throw Error('MLB_PIT_GAME_AND_CHECKPOINT_REQUIRED');
 if(!features||typeof features!=='object')throw Error('MLB_PIT_FEATURE_EVIDENCE_REQUIRED');
 const cutoff=Date.parse(maxObservationTime),visited=new WeakSet();
 const scan=(node,path)=>{
  if(node===null||typeof node!=='object'||visited.has(node))return;
  visited.add(node);
  for(const [key,value] of Object.entries(node)){
   const next=path+'.'+key;
   if(MLB_PIT_SOURCE_TIMES.has(key)&&value!=null){
    if(!stamp(value)||Date.parse(value)>cutoff)throw Error('MLB_PIT_SOURCE_AFTER_CHECKPOINT:'+next);
   }else if(value&&typeof value==='object')scan(value,next);
  }
 };
 scan(features,'features');
 return true;
}
export function selectMlbFeatureRows({packets=[],playerId,role,capturedAt=new Date().toISOString()}={}){
 if(!/^\d+$/.test(String(playerId))||!['pitcher','batter'].includes(role)||!stamp(capturedAt))throw Error('INVALID_FEATURE_SCOPE');
 const day=capturedAt.slice(0,10),seen=new Set(),sources=[],rows=[];
 for(const p of packets){
  if(String(p.playerId)!==String(playerId)||p.role!==role)throw Error('FEATURE_IDENTITY_MISMATCH');
  if(!stamp(p.observedAt)||Date.parse(p.observedAt)>Date.parse(capturedAt)||sha256Hex(JSON.stringify(p.rows))!==p.sourceHash)throw Error('FEATURE_SOURCE_NOT_AVAILABLE_OR_CORRUPT');
  sources.push({season:p.season,sourceHash:p.sourceHash,observedAt:p.observedAt});
  for(const r of p.rows){if(String(r[role])!==String(playerId))throw Error('FEATURE_ROW_IDENTITY_MISMATCH');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(r.game_date)||!Number.isFinite(Date.parse(r.game_date))||r.game_date>=day||!['R','F','D','L','W'].includes(r.game_type))continue;
   const key=`${r.game_pk}:${r.at_bat_number}:${r.pitch_number}`;if(seen.has(key))continue;seen.add(key);rows.push(r);
  }
 }
 return {rows,sources,day};
}
export function buildMlbModelFeatures({packets=[],playerId,role,capturedAt=new Date().toISOString()}={}){
 const {rows,sources,day}=selectMlbFeatureRows({packets,playerId,role,capturedAt});
 // A single synthetic season is only an aggregation container; game dates retain window membership.
 const windows=[30,90,365].map(days=>{
  const start=new Date(Date.parse(day)-days*86400000).toISOString().slice(0,10);
  const sample=rows.filter(r=>r.game_date>=start),season=Number(day.slice(0,4));
  return {days,start,throughExclusive:day,splits:['all','L','R'].map(hand=>{
   const lab=buildMlbStatcastLab([{role,season,rows:sample}],{season,hand});
   return {hand,pitches:lab.pitches,plateAppearances:lab.plateAppearances,battedBalls:lab.battedBalls,metrics:lab.metrics,arsenal:lab.arsenal,coverage:lab.coverage,smallSample:lab.smallSample};
  })};
 });
 const evidence={version:MLB_FEATURE_VERSION,calculationVersion:MLB_STATCAST_LAB_CALC_VERSION,playerId:String(playerId),role,capturedAt,throughExclusive:day,sources,windows,productionProjectionChanged:false,canAuthorizeWager:false};
 return {...evidence,evidenceHash:sha256Hex(JSON.stringify(evidence))};
}
export async function persistMlbModelFeatures(env,options){
 if(!env.ARCHIVE?.put)throw Error('ARCHIVE_UNBOUND');
 const snapshot=buildMlbModelFeatures(options);
 const key=`models/mlb/features/v1/${snapshot.role}/${snapshot.playerId}/${snapshot.capturedAt.slice(0,10)}/${snapshot.evidenceHash}.json`;
 await env.ARCHIVE.put(key,JSON.stringify(snapshot),{httpMetadata:{contentType:'application/json'},onlyIf:new Headers({'If-None-Match':'*'})});
 return {ok:true,key,evidenceHash:snapshot.evidenceHash,capturedAt:snapshot.capturedAt,sources:snapshot.sources.length,pitches:snapshot.windows[2].splits[0].pitches};
}
/** Compare paired frozen binary predictions only; no fitting on evaluation outcomes. */
export function evaluateMlbFeaturePredictions(records){
 const seen=new Set(),groups=new Map();
 for(const r of records){
  if(!stamp(r.capturedAt)||!stamp(r.featureCapturedAt)||!stamp(r.gameStart)||!stamp(r.settledAt)||Date.parse(r.featureCapturedAt)>Date.parse(r.capturedAt)||Date.parse(r.capturedAt)>=Date.parse(r.gameStart)||Date.parse(r.settledAt)<=Date.parse(r.gameStart))throw Error('NON_PROSPECTIVE_EVALUATION_ROW');
  if(!r.contractId||!r.featureHash||!r.championVersion||!r.challengerVersion||![0,1].includes(r.outcome)||![r.champion,r.challenger].every(p=>typeof p==='number'&&Number.isFinite(p)&&p>0&&p<1))throw Error('INVALID_EVALUATION_ROW');
  const key=String(r.contractId);if(seen.has(key))throw Error('DUPLICATE_EVALUATION_CONTRACT');seen.add(key);
  if(!r.market||!r.season||!r.scope)throw Error('EVALUATION_COHORT_REQUIRED');
  const cohort=JSON.stringify([r.market,r.season,r.scope,r.championVersion,r.challengerVersion]);
  if(!groups.has(cohort))groups.set(cohort,[]);groups.get(cohort).push(r);
 }
 const score=(rs,field)=>({brier:rs.reduce((s,r)=>s+(r[field]-r.outcome)**2,0)/rs.length,logLoss:-rs.reduce((s,r)=>s+r.outcome*Math.log(r[field])+(1-r.outcome)*Math.log(1-r[field]),0)/rs.length});
 return {version:MLB_FEATURE_VERSION,cohorts:[...groups].map(([cohort,rs])=>({cohort:JSON.parse(cohort),count:rs.length,champion:score(rs,'champion'),challenger:score(rs,'challenger')})),canPromote:false,limitations:['Caller must verify immutable prediction receipts and source hashes.','Scores alone do not establish calibration, statistical significance, or net profitability.']};
}
