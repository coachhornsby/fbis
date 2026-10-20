import {persistPropEvidence} from './propEvidenceStore.js';
const ROOT='player-props/evidence/v1/prospective-index.json';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const str=x=>typeof x==='string'&&x.length>0;
/** Only source-derived pre-event research inputs. Unverified quotes stay non-executable. */
export function prospectivePropPayload(row,kind,now){
 const captured=now.toISOString(),event=Date.parse(row?.start_time);
 if(!Number.isFinite(event)||event<=now.getTime()||
    !str(row?.canonicalEventId)||!str(row?.canonicalPlayerId)||!str(row?.canonical_market)||
    row?.period!=='full_game')return null;
 if(kind==='FROZEN_PROJECTION'){
  const asOf=Date.parse(row.modelAsOf);
  if(row.independent!==true||row.marketInformed===true||!finite(row.fbis_projection)||
     !str(row.modelVersion)||!Number.isFinite(asOf)||asOf>now.getTime()||asOf>=event)return null;
  return {schemaVersion:1,kind,observedAt:captured,
   canonicalEventId:row.canonicalEventId,canonicalPlayerId:row.canonicalPlayerId,
   sourceId:'fbis:model:'+row.modelVersion,
   prediction:{canonicalEventId:row.canonicalEventId,canonicalPlayerId:row.canonicalPlayerId,
    canonical_market:row.canonical_market,period:row.period,projection:row.fbis_projection,
    modelVersion:row.modelVersion,modelAsOf:row.modelAsOf,asOf:row.modelAsOf,
    frozenAt:captured,eventStart:row.start_time,independent:true}};
 }
 if(kind==='MARKET_SNAPSHOT'){
  const time=Date.parse(row.collectedAt);
  if(row.provider!=='Kalshi'||row.identityVerified!==true||!str(row.contractId)||
    !Number.isFinite(time)||time>now.getTime()||time>=event)return null;
  return {schemaVersion:1,kind,observedAt:row.collectedAt,
   canonicalEventId:row.canonicalEventId,canonicalPlayerId:row.canonicalPlayerId,
   sourceId:'kalshi:'+row.contractId,quoteTimeBasis:'REST_CAPTURE_ONLY',
   quoteSourceObservedAt:null,purchaseAsk:null,verifiedFees:null,
   settlementPolicyVerified:false,settlementPolicySourceId:null,
   contract:{canonicalEventId:row.canonicalEventId,canonicalPlayerId:row.canonicalPlayerId,
    canonical_market:row.canonical_market,period:row.period,contractId:row.contractId,
    provider:'Kalshi',line:row.line,statSide:row.statSide,eventStart:row.start_time,
    settlementTerms:row.settlementTerms,identityVerified:true,settlementVerified:false}};
 }
 return null;
}
export async function captureProspectivePropEvidence(env,{projections=[],markets=[],now=new Date(),webCrypto=globalThis.crypto}={}){
 if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)return {ok:false,reason:'ARCHIVE_UNBOUND'};
 let index;
 try {const f=await env.ARCHIVE.get(ROOT);index=f?await f.json():{version:1,entries:[]};}
 catch{return {ok:false,reason:'INDEX_READ_FAILED'};}
 if(index?.version!==1||!Array.isArray(index.entries))return {ok:false,reason:'INDEX_INVALID'};
 const entries=[...index.entries],seen=new Set(entries.map(e=>e.identityKey)),receipts=[];
 for(const [kind,rows] of [['FROZEN_PROJECTION',projections],['MARKET_SNAPSHOT',markets]]){
  for(const row of rows.slice(0,32)){
   const payload=prospectivePropPayload(row,kind,now);
   if(!payload){receipts.push({ok:false,kind,reason:'PREGAME_SOURCE_EVIDENCE_REQUIRED'});continue;}
   const identityKey=kind==='FROZEN_PROJECTION'?
    [kind,row.canonicalEventId,row.canonicalPlayerId,row.canonical_market,row.modelVersion,row.modelAsOf,row.fbis_projection].join('|'):
    [kind,row.contractId,row.side,row.collectedAt].join('|');
   if(seen.has(identityKey)){receipts.push({ok:true,kind,status:'ALREADY_INDEXED'});continue;}
   const write=await persistPropEvidence(env,payload,{webCrypto});
   if(!write.ok){receipts.push({ok:false,kind,reason:write.reason});continue;}
   entries.push({identityKey,id:write.id,kind,canonicalEventId:row.canonicalEventId,
    canonicalPlayerId:row.canonicalPlayerId,market:row.canonical_market,
    modelVersion:row.modelVersion||null,eventStart:row.start_time,asOf:payload.observedAt});
   seen.add(identityKey);receipts.push({ok:true,kind,status:'CAPTURED'});
  }
 }
 try{await env.ARCHIVE.put(ROOT,JSON.stringify({version:1,entries:entries.slice(-512),updatedAt:now.toISOString()}));}
 catch{return {ok:false,reason:'INDEX_WRITE_FAILED',receipts};}
 return {ok:true,captured:receipts.filter(r=>r.status==='CAPTURED').length,
  blocked:receipts.filter(r=>!r.ok).length,indexSize:Math.min(512,entries.length),
  receipts,canQualify:false,canAuthorizeWager:false};
}
