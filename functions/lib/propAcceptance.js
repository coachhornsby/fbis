import { finitePropNumber as number } from './exchangePlayerProps.js';
const text=v=>typeof v==='string'&&v.trim().length>0;
const clock=v=>text(v)?Date.parse(v):NaN;
const stat=v=>v==='pra'?'points_rebounds_assists':v;
export const propIdentityKey=r=>[r.sport,r.canonicalEventId,r.canonicalPlayerId,stat(r.canonical_market),r.period].join('|');

/** Display completeness is separate from forecast validation and executable value. */
export function assessPropModel(row,{now=Date.now()}={}) {
 const reasons=[];
 if(!text(row?.canonicalEventId)||!text(row?.canonicalPlayerId)||!row.canonicalPlayerId.startsWith(row.sport+':')||row.identityVerified!==true)reasons.push('CANONICAL_IDENTITY_MISSING');
 if(!text(row?.player_name)||!text(row?.team)||!text(row?.opponent))reasons.push('PLAYER_FIXTURE_CONTEXT_MISSING');
 if(!text(row?.canonical_market)||row.period!=='full_game')reasons.push('STAT_PERIOD_MISSING');
 if(row.independent!==true||row.marketInformed===true||number(row.fbis_projection)==null)reasons.push('INDEPENDENT_PROJECTION_MISSING');
 if(!text(row.modelId)||!text(row.modelVersion))reasons.push('MODEL_VERSION_MISSING');
 const start=clock(row.start_time),asOf=clock(row.modelAsOf);
 if(!Number.isFinite(start)||start<=now)reasons.push('EVENT_NOT_UPCOMING');
 if(!Number.isFinite(asOf)||asOf>now||asOf>=start)reasons.push('MODEL_INPUT_CLOCK_MISSING_OR_INVALID');
 const maxHours={nfl:192,cfb:192,nba:72,wnba:72,cbb:72,mlb:14,nhl:24}[row.sport]||72;
 if(Number.isFinite(asOf)&&now-asOf>maxHours*3600000)reasons.push('MODEL_INPUT_STALE');
 if(['OUT','IR','PUP','NFI','SUSPENDED'].includes(String(row.availabilityStatus||'').toUpperCase()))reasons.push('PLAYER_UNAVAILABLE');
 const gaps=[];
 if(number(row.sigma)==null||number(row.sigma)<=0)gaps.push('UNCERTAINTY_MISSING');
 if(!row.availabilityStatus||row.availabilityStatus==='UNKNOWN')gaps.push('AVAILABILITY_UNKNOWN');
 const inputs=row.researchInputs||{};
 if(![inputs.projectedMinutes,inputs.snapShare,inputs.expectedInnings,inputs.expectedPlateAppearances,inputs.iceTimeSeconds].some(v=>number(v)!=null))gaps.push('EXPECTED_WORKLOAD_MISSING');
 return {displayReady:reasons.length===0,reasons,gaps,canAuthorizeWager:false};
}

export function buildPropAcceptance({models=[],contracts=[],historyByPlayer={},sport,date,now=Date.now(),sourceDiagnostics=[]}={}) {
 const keyCount=new Map();for(const r of models){const key=propIdentityKey(r);keyCount.set(key,(keyCount.get(key)||0)+1);}
 const contractCounts=new Map();for(const c of contracts)if(c.identityVerified===true){const key=propIdentityKey(c);contractCounts.set(key,(contractCounts.get(key)||0)+1);}
 const checks=models.map(row=>{const result=assessPropModel(row,{now});
  if(keyCount.get(propIdentityKey(row))!==1)result.reasons.push('AMBIGUOUS_MODEL_IDENTITY');
  result.displayReady=result.reasons.length===0;
  const history=historyByPlayer[row.canonicalPlayerId]?.[stat(row.canonical_market)];
  return {id:row.id,player:row.player_name,market:row.canonical_market,modelId:row.modelId,modelVersion:row.modelVersion,modelAsOf:row.modelAsOf,eventStart:row.start_time,...result,
   history:history?.identityVerified===true&&history?.available===true?{state:'AVAILABLE',games:history.games?.length||0,last5:history.last5?.length||0,source:history.source}: {state:history?'UNAVAILABLE':'NOT_CHECKED',reason:history?.reason||'HISTORY_REQUIRES_EXACT_PLAYER_READ'},
   matchedContracts:contractCounts.get(propIdentityKey(row))||0};
 });
 const matched=new Set(models.filter(r=>assessPropModel(r,{now}).displayReady&&keyCount.get(propIdentityKey(r))===1).map(propIdentityKey));
 const reasons={};for(const r of checks)for(const reason of [...r.reasons,...r.gaps])reasons[reason]=(reasons[reason]||0)+1;
 const unmatched=contracts.filter(r=>!matched.has(propIdentityKey(r)));
 return {schemaVersion:1,sport,date,checkedAt:new Date(now).toISOString(),
  status:sourceDiagnostics.length?'INCOMPLETE_SOURCE_COVERAGE':checks.length&&checks.every(r=>r.displayReady)?'DISPLAY_METADATA_COMPLETE':'GAPS_PRESENT',
  counts:{models:models.length,displayReady:checks.filter(r=>r.displayReady).length,withheldModels:checks.filter(r=>!r.displayReady).length,contracts:contracts.length,matchedContracts:contracts.length-unmatched.length,unmatchedContracts:unmatched.length,historyChecked:checks.filter(r=>r.history.state!=='NOT_CHECKED').length},
  reasonCounts:reasons,sourceDiagnostics,rows:checks,
  unmatchedContracts:unmatched.map(r=>({id:r.id,player:r.player_name,market:r.canonical_market,reason:keyCount.has(propIdentityKey(r))?'MODEL_ACCEPTANCE_FAILED':'INDEPENDENT_MODEL_NOT_MATCHED'})),
  probabilityCalibration:'REQUIRES_SEPARATE_PROSPECTIVE_EVIDENCE',profitability:'NO_EXECUTED_WAGERS_INFERRED',canQualify:false,canAuthorizeWager:false};
}
