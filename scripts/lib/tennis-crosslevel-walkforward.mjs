// Source-observed cross-level tennis service/return evaluation.
// Research-only under Sackmann noncommercial terms. Never a production profile feed.
import {hasValidTwoSidedServeStats,sourceSurface} from './tennis-lowtier-source-audit.mjs';

export const TRAIN_END={2025:2024,2026:2025};
export const sourceFiles=[...[2024,2025,2026].flatMap(year=>[
 {tour:'atp',year,sourceTier:'MAIN_TOUR',path:`atp/atp_matches_${year}.csv`},
 {tour:'atp',year,sourceTier:'ATP_QUAL_CHALL',path:`atp/atp_matches_qual_chall_${year}.csv`},
 {tour:'atp',year,sourceTier:'ATP_FUTURES',path:`atp/atp_matches_futures_${year}.csv`},
 {tour:'wta',year,sourceTier:'MAIN_TOUR',path:`wta/wta_matches_${year}.csv`},
 {tour:'wta',year,sourceTier:'WTA_QUAL_ITF',path:`wta/wta_matches_qual_itf_${year}.csv`}
])];

export function tierOf(meta,row){
 const level=String(row.tourney_level||'').trim().toUpperCase();
 // Source CSVs mix qualifying, Challenger and ITF competition. Preserve actual
 // tourney_level, never treat all records from a source file as one level.
 if(!/^[A-Z0-9]{1,2}$/.test(level))return null;
 return meta.sourceTier==='MAIN_TOUR'?'MAIN_TOUR':meta.sourceTier+':'+level;
}
const observed=(record,side)=>{
 const svpt=Number(record[side+'_svpt']);
 const first=Number(record[side+'_1stWon']);
 const second=Number(record[side+'_2ndWon']);
 return {svpt,won:first+second};
};
const blank=()=>({matches:0,svpt:0,serveWon:0,returnPts:0,returnWon:0});
const emptyGroup=()=>new Map();
const groupKey=(tour,year,tier,surface)=>[tour,year,tier,surface].join('|');
export function ingestCrossLevelRows(store,meta,rows,{cutoffExclusive='99999999'}={}){
 const seen=store.seen||(store.seen=new Set());
 const data=store.groups||(store.groups=new Map());
 let accepted=0,invalidStats=0,afterCutoff=0,duplicate=0,invalidLevel=0;
 for(const row of rows){
  const date=String(row.tourney_date||'');
  if(!/^[0-9]{8}$/.test(date) || ![2024,2025,2026].includes(Number(date.slice(0,4))))continue;
  // Tournament DATE is not match timestamp. Exclude even the start date of
  // a tournament if it is not older than the conservative cutoff.
  if(date>=cutoffExclusive){afterCutoff++;continue}
  const surface=sourceSurface(row.surface);
  const tier=tierOf(meta,row);
  if(!surface||!tier){invalidLevel++;continue}
  if(!row.winner_id||!row.loser_id||row.winner_id===row.loser_id)continue;
  const unique=[meta.tour,tier,row.tourney_id,date,row.match_num,
     row.winner_id,row.loser_id].join('|');
  if(seen.has(unique)){duplicate++;continue}
  seen.add(unique);
  if(!hasValidTwoSidedServeStats(row)){invalidStats++;continue}
  const year=Number(date.slice(0,4));
  const group=groupKey(meta.tour,year,tier,surface);
  if(!data.has(group))data.set(group,emptyGroup());
  const players=data.get(group);
  for(const [side,other,id] of [['w','l',row.winner_id],['l','w',row.loser_id]]){
   const cur=observed(row,side),opp=observed(row,other);
   const sid=String(id);
   if(!players.has(sid))players.set(sid,blank());
   const p=players.get(sid);
   p.matches++;p.svpt+=cur.svpt;p.serveWon+=cur.won;
   p.returnPts+=opp.svpt;p.returnWon+=opp.svpt-opp.won;
  }
  accepted++;
 }
 return {source:meta.path,tierFamily:meta.sourceTier,rows:rows.length,accepted,
   invalidStats,afterCutoff,duplicate,invalidLevel};
}
function merge(to,from){
 to.matches+=from.matches;to.svpt+=from.svpt;to.serveWon+=from.serveWon;
 to.returnPts+=from.returnPts;to.returnWon+=from.returnWon;
}
function aggregated(store,tour,tier,surface,maxYear,minYear=2024){
 const out=new Map();
 for(let year=minYear;year<=maxYear;year++){
  for(const [id,p] of store.groups.get(groupKey(tour,year,tier,surface))||[]){
   if(!out.has(id))out.set(id,blank());
   merge(out.get(id),p);
  }
 }
 return out;
}
const rate=(p,field)=>p[field==='serve'?'serveWon':'returnWon']/p[field==='serve'?'svpt':'returnPts'];
const points=(p,field)=>p[field==='serve'?'svpt':'returnPts'];
const good=(p,field,{minMatches,minPoints})=>p&&p.matches>=minMatches&&points(p,field)>=minPoints;
function fitAdjustment(store,tour,tier,surface,trainEnd,field,policy){
 const main=aggregated(store,tour,'MAIN_TOUR',surface,trainEnd);
 const lower=aggregated(store,tour,tier,surface,trainEnd);
 let weighted=0,weight=0,overlapPlayers=0;
 for(const [id,lo] of lower){
  const hi=main.get(id);
  if(!good(lo,field,{minMatches:3,minPoints:100})||
     !good(hi,field,{minMatches:3,minPoints:100}))continue;
  const w=Math.min(points(lo,field),points(hi,field),500);
  weighted+=w*(rate(hi,field)-rate(lo,field));
  weight+=w;overlapPlayers++;
 }
 const eligible=overlapPlayers>=policy.minOverlapPlayers&&weight>=policy.minOverlapPoints;
 const delta=weight?weighted/weight:null;
 return {overlapPlayers,overlapPoints:Math.round(weight),delta:eligible?delta:null,
   rawObservedDelta:delta,eligible,
   blockedReason:eligible?null:'INSUFFICIENT_BOTH_TIER_TRAINING_OVERLAP'};
}
function scoreHoldout(store,tour,tier,surface,trainEnd,holdoutYear,field,fit,policy){
 const lower=aggregated(store,tour,tier,surface,trainEnd);
 const targets=aggregated(store,tour,'MAIN_TOUR',surface,holdoutYear,holdoutYear);
 let players=0,pts=0,rawError=0,adjustedError=0;
 let nWithMainTraining=0;
 const historicalMain=aggregated(store,tour,'MAIN_TOUR',surface,trainEnd);
 for(const [id,truth] of targets){
  const lo=lower.get(id);
  if(!good(lo,field,{minMatches:3,minPoints:100})||
     !good(truth,field,{minMatches:1,minPoints:40}))continue;
  const observed=rate(truth,field),p=rate(lo,field),w=points(truth,field);
  if(!Number.isFinite(p)||!Number.isFinite(observed))continue;
  const adj=fit.eligible?Math.max(.01,Math.min(.99,p+fit.delta)):null;
  pts+=w;players++;
  // Per service/return point Bernoulli Brier score, not a match-winner metric.
  rawError+=w*(observed-2*p*observed+p*p);
  if(adj!==null)adjustedError+=w*(observed-2*adj*observed+adj*adj);
  if(good(historicalMain.get(id),field,{minMatches:3,minPoints:100}))nWithMainTraining++;
 }
 const evaluable=players>=policy.minHoldoutPlayers&&pts>=policy.minHoldoutPoints;
 const raw=pts?rawError/pts:null,adjusted=pts&&fit.eligible?adjustedError/pts:null;
 return {holdoutPlayers:players,holdoutPoints:pts,playersWithPriorMainHistory:nWithMainTraining,
  rawBrier:raw,adjustedBrier:adjusted,
  brierDelta:raw!=null&&adjusted!=null?raw-adjusted:null,
  evaluable,blockedReason:evaluable?null:'INSUFFICIENT_HELDOUT_MAIN_TOUR_EVIDENCE'};
}
export function runCrossLevelEvaluation(store,policy={
 minOverlapPlayers:12,minOverlapPoints:4000,minHoldoutPlayers:12,minHoldoutPoints:4000
}){
 const tiers=new Set();
 for(const key of store.groups.keys()){
  const [tour,,tier,surface]=key.split('|');
  if(tier!=='MAIN_TOUR')tiers.add([tour,tier,surface].join('|'));
 }
 const folds=[];
 for(const key of [...tiers].sort()){
  const [tour,tier,surface]=key.split('|');
  for(const [yearText,trainEnd] of Object.entries(TRAIN_END)){
   const year=Number(yearText);
   for(const metric of ['serve','return']){
    const fit=fitAdjustment(store,tour,tier,surface,trainEnd,metric,policy);
    const holdout=scoreHoldout(store,tour,tier,surface,trainEnd,year,metric,fit,policy);
    const statQualified=fit.eligible&&holdout.evaluable;
    folds.push({tour,tier,surface,metric,trainingYears:`2024-${trainEnd}`,holdoutYear:year,
      calibration:fit,holdout,statisticallyEvaluable:statQualified,
      observedImprovement:statQualified&&holdout.brierDelta>0,
      qualification:'RESEARCH_DIAGNOSTIC_ONLY',
      commercialUseApproved:false,canQualify:false,canAuthorizeWager:false});
   }
  }
 }
 const ready=folds.filter(x=>x.statisticallyEvaluable);
 return {generatedAt:new Date().toISOString(),method:'LEAVE_FUTURE_SEASONS_OUT',
  temporalRule:'2024→2025 and 2024+2025→2026; no holdout outcomes used in fitting',
  dateLimit:'tourney_date is tournament start, not actual match time; conservative recent cutoff applied',
  metric:'HOLDOUT_MAIN_TOUR_POINT_LEVEL_BRIER',
  license:'CC BY-NC-SA 4.0',use:'PRIVATE_NONCOMMERCIAL_RESEARCH_ONLY',
  policy,combinations:[...tiers].length,foldsTotal:folds.length,
  foldsStatisticallyEvaluable:ready.length,
  foldsImproved:ready.filter(x=>x.observedImprovement).length,
  noClaimsWhenInsufficient:true,canQualify:false,canAuthorizeWager:false,productionWrites:0,
  findings:folds};
}
