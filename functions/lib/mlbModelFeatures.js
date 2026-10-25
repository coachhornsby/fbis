/** Point-in-time feature evidence. No market inputs or projection authority. */
import {buildMlbStatcastLab,MLB_STATCAST_LAB_CALC_VERSION} from './mlbStatcastLab.js';
import {sha256Hex} from './sha256Hex.js';
export const MLB_FEATURE_VERSION='mlb-statcast-features-v1';
// Source timestamps must identify an absolute instant. Do not silently interpret
// timezone-less wall clocks as UTC or mistake a date-only coverage marker for
// an exact collection receipt.
const PIT_INSTANT=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/i;
const PIT_DAY=/^\d{4}-\d{2}-\d{2}$/;
function validUtcDay(day){
 if(!PIT_DAY.test(day))return false;
 const parsed=Date.parse(day+'T00:00:00Z');
 return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===day;
}
function parsePitInstant(value){
 if(typeof value==='number'){
  // Explicitly distinguish provider Unix seconds from Unix milliseconds.
  if(!Number.isSafeInteger(value))return null;
  const ms=value>=1e9&&value<1e11?value*1000:value>=1e12&&value<1e14?value:null;
  return ms!=null&&Number.isFinite(ms)&&ms>=946684800000&&ms<4102444800000?ms:null;
 }
 if(typeof value!=='string')return null;
 const match=PIT_INSTANT.exec(value);
 if(!match||!validUtcDay(match[1]+'-'+match[2]+'-'+match[3]))return null;
 const hour=Number(match[4]),minute=Number(match[5]),second=Number(match[6]),tz=match[7];
 if(hour>23||minute>59||second>59)return null;
 if(tz.length>1&&Number(tz.slice(1,3))===14&&tz.slice(-2)!=='00')return null;
 const instant=Date.parse(value);
 return Number.isFinite(instant)?instant:null;
}
const stamp=s=>parsePitInstant(s)!==null;
function pitSourceUpperBound(value){
 const instant=parsePitInstant(value);
 if(instant!==null)return instant;
 // Date-only sources provide, at best, a UTC day of coverage. The source
 // might not have existed until the end of that day; do not infer midnight.
 if(typeof value==='string'&&validUtcDay(value))return Date.parse(value+'T00:00:00Z')+86400000;
 return null;
}

// Source availability is bounded by the exact prediction freeze, not merely first pitch.
// Scan nested evidence without treating game dates, kickoff or predicted times as source receipts.
const MLB_PIT_SOURCE_TIMES=new Set([
 'observedAt','observed_at','observation_timestamp','observationTimestamp',
 'sourceObservedAt','source_observed_at','sourceTimestamp','source_timestamp',
 'acquiredAt','acquired_at','acquisitionTimestamp','acquisition_timestamp',
 'collectedAt','collected_at','capturedAt','captured_at','featureCapturedAt','feature_captured_at',
 'fetchedAt','fetched_at','ingestedAt','ingested_at',
 'asOf','sourceAsOf','source_as_of','palAsOf','profileAsOf'
]);
export function validatePregameSnapshot(fixture,features,maxObservationTime){
 const gameStart=fixture?.game_time??fixture?.start;
 const startMs=parsePitInstant(gameStart),cutoffMs=parsePitInstant(maxObservationTime);
 if(startMs===null||cutoffMs===null||cutoffMs>=startMs)throw Error('MLB_PIT_GAME_AND_CHECKPOINT_REQUIRED');
 if(!features||typeof features!=='object')throw Error('MLB_PIT_FEATURE_EVIDENCE_REQUIRED');
 const cutoff=cutoffMs,visited=new WeakSet();
 const scan=(node,path)=>{
  if(node===null||typeof node!=='object'||visited.has(node))return;
  visited.add(node);
  for(const [key,value] of Object.entries(node)){
   const next=path+'.'+key;
   if(MLB_PIT_SOURCE_TIMES.has(key)&&value!=null){
    const sourceBound=pitSourceUpperBound(value);
    if(sourceBound===null||sourceBound>cutoff)throw Error('MLB_PIT_SOURCE_AFTER_CHECKPOINT:'+next);
   }else if(value&&typeof value==='object')scan(value,next);
  }
 };
 scan(features,'features');
 return true;
}
export function selectMlbFeatureRows({packets=[],playerId,role,capturedAt=new Date().toISOString()}={}){
 if(!/^\d+$/.test(String(playerId))||!['pitcher','batter'].includes(role)||!stamp(capturedAt))throw Error('INVALID_FEATURE_SCOPE');
 const day=new Date(parsePitInstant(capturedAt)).toISOString().slice(0,10),seen=new Set(),sources=[],rows=[];
 for(const p of packets){
  if(String(p.playerId)!==String(playerId)||p.role!==role)throw Error('FEATURE_IDENTITY_MISMATCH');
  if(!stamp(p.observedAt)||parsePitInstant(p.observedAt)>parsePitInstant(capturedAt)||sha256Hex(JSON.stringify(p.rows))!==p.sourceHash)throw Error('FEATURE_SOURCE_NOT_AVAILABLE_OR_CORRUPT');
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
 const key=`models/mlb/features/v1/${snapshot.role}/${snapshot.playerId}/${snapshot.throughExclusive}/${snapshot.evidenceHash}.json`;
 await env.ARCHIVE.put(key,JSON.stringify(snapshot),{httpMetadata:{contentType:'application/json'},onlyIf:new Headers({'If-None-Match':'*'})});
 return {ok:true,key,evidenceHash:snapshot.evidenceHash,capturedAt:snapshot.capturedAt,sources:snapshot.sources.length,pitches:snapshot.windows[2].splits[0].pitches};
}
/** Compare paired frozen binary predictions only; no fitting on evaluation outcomes. */
export function evaluateMlbFeaturePredictions(records){
 const seen=new Set(),groups=new Map();
 for(const r of records){
  if(!stamp(r.capturedAt)||!stamp(r.featureCapturedAt)||!stamp(r.gameStart)||!stamp(r.settledAt)||parsePitInstant(r.featureCapturedAt)>parsePitInstant(r.capturedAt)||parsePitInstant(r.capturedAt)>=parsePitInstant(r.gameStart)||parsePitInstant(r.settledAt)<=parsePitInstant(r.gameStart))throw Error('NON_PROSPECTIVE_EVALUATION_ROW');
  if(!r.contractId||!r.featureHash||!r.championVersion||!r.challengerVersion||![0,1].includes(r.outcome)||![r.champion,r.challenger].every(p=>typeof p==='number'&&Number.isFinite(p)&&p>0&&p<1))throw Error('INVALID_EVALUATION_ROW');
  const key=String(r.contractId);if(seen.has(key))throw Error('DUPLICATE_EVALUATION_CONTRACT');seen.add(key);
  if(!r.market||!r.season||!r.scope)throw Error('EVALUATION_COHORT_REQUIRED');
  const cohort=JSON.stringify([r.market,r.season,r.scope,r.championVersion,r.challengerVersion]);
  if(!groups.has(cohort))groups.set(cohort,[]);groups.get(cohort).push(r);
 }
 const score=(rs,field)=>({brier:rs.reduce((s,r)=>s+(r[field]-r.outcome)**2,0)/rs.length,logLoss:-rs.reduce((s,r)=>s+r.outcome*Math.log(r[field])+(1-r.outcome)*Math.log(1-r[field]),0)/rs.length});
 return {version:MLB_FEATURE_VERSION,cohorts:[...groups].map(([cohort,rs])=>({cohort:JSON.parse(cohort),count:rs.length,champion:score(rs,'champion'),challenger:score(rs,'challenger')})),canPromote:false,limitations:['Caller must verify immutable prediction receipts and source hashes.','Scores alone do not establish calibration, statistical significance, or net profitability.']};
}
