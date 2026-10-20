import { persistPropEvidence } from './propEvidenceStore.js';

/** Freeze only independently generated pre-start model rows. No inferred timestamps. */
export function prospectivePropEnvelope(row,{observedAt}={}){
 const blocked=reason=>({ok:false,reason});
 if(!row||row.independent!==true||row.marketInformed===true||row.identityVerified!==true)
  return blocked('INDEPENDENT_CANONICAL_MODEL_REQUIRED');
 const start=Date.parse(row.start_time),asOf=Date.parse(row.modelAsOf),capture=Date.parse(observedAt);
 if(!Number.isFinite(start)||!Number.isFinite(asOf)||!Number.isFinite(capture)||
  asOf>capture||capture>=start||asOf>=start)return blocked('VERIFIED_PROSPECTIVE_CLOCKS_REQUIRED');
 if(!row.canonicalEventId||!row.canonicalPlayerId||!row.canonical_market||row.period!=='full_game'||
  !row.modelVersion||!row.modelId||!Number.isFinite(row.fbis_projection))
  return blocked('MODEL_IDENTITY_OR_VERSION_REQUIRED');
 return {ok:true,payload:{schemaVersion:1,kind:'FROZEN_PROJECTION',observedAt,
  canonicalEventId:row.canonicalEventId,canonicalPlayerId:row.canonicalPlayerId,
  sourceId:String(row.modelId)+':'+String(row.modelVersion),prediction:{
   canonicalEventId:row.canonicalEventId,canonicalPlayerId:row.canonicalPlayerId,
   canonical_market:row.canonical_market,period:row.period,
   modelVersion:row.modelVersion,modelId:row.modelId,projection:row.fbis_projection,
   sigma:Number.isFinite(row.sigma)?row.sigma:null,asOf:row.modelAsOf,frozenAt:observedAt,
   eventStart:row.start_time},canQualify:false,canAuthorizeWager:false}};
}
export async function captureProspectivePropResearch(env,rows,{now=new Date(),webCrypto=globalThis.crypto,maxRows=50}={}){
 if(!Array.isArray(rows)||rows.length>500)return {ok:false,reason:'BOUNDED_MODEL_ROWS_REQUIRED'};
 const observedAt=now.toISOString(),receipts=[];
 for(const row of rows.slice(0,Math.min(50,maxRows))){
  const checked=prospectivePropEnvelope(row,{observedAt});
  if(!checked.ok){receipts.push({ok:false,reason:checked.reason});continue;}
  const saved=await persistPropEvidence(env,checked.payload,{webCrypto});
  receipts.push({ok:saved.ok,id:saved.id||null,reason:saved.reason||null});
 }
 return {ok:receipts.every(r=>r.ok)&&receipts.length>0,observedAt,stored:receipts.filter(r=>r.ok).length,
  blocked:receipts.filter(r=>!r.ok).length,receipts,canQualify:false,canAuthorizeWager:false};
}
