import {reconcileOfficialProp} from './propOfficialReconciler.js';
const KEY='player-props/evidence/v1/reconciliation-queue.json';
const RECEIPT='player-props/evidence/v1/reconciliation-status.json';
const isHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
/** Bounded, authenticated-service-only research reconciliation from R2 ID queue. */
export async function reconcileQueuedPropEvidence(env,{now=new Date(),webCrypto=globalThis.crypto,maxJobs=12}={}){
 if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)return {ok:false,reason:'ARCHIVE_UNBOUND'};
 let manifest;
 try{const item=await env.ARCHIVE.get(KEY);manifest=item?await item.json():null;}
 catch{return {ok:false,reason:'QUEUE_READ_FAILED'};}
 if(manifest?.version!==1||manifest.approved!==true||!Array.isArray(manifest.jobs))
  return {ok:false,reason:'APPROVED_QUEUE_REQUIRED'};
 const receipts=[];
 for(const job of manifest.jobs.slice(0,Math.min(12,Math.max(1,maxJobs)))){
  if(![job?.projectionId,job?.marketId,job?.resultId].every(isHash)){
   receipts.push({ok:false,reason:'INVALID_CONTENT_ADDRESSED_IDS'});continue;
  }
  try{
   const r=await reconcileOfficialProp(env,{...job,observedAt:now.toISOString(),webCrypto});
   receipts.push({ok:r.ok,status:r.status,reason:r.reason||null,
    gradeEvidenceId:r.gradeEvidenceId||null,alreadyPersisted:r.alreadyPersisted===true});
  }catch{receipts.push({ok:false,reason:'RECONCILIATION_FAILED'});}
 }
 const status={version:1,checkedAt:now.toISOString(),attempted:receipts.length,
  graded:receipts.filter(r=>r.ok).length,blocked:receipts.filter(r=>!r.ok).length,
  receipts,canQualify:false,canAuthorizeWager:false};
 try{await env.ARCHIVE.put(RECEIPT,JSON.stringify(status),{httpMetadata:{contentType:'application/json'}});}
 catch{return {ok:false,reason:'RECEIPT_PERSISTENCE_FAILED',...status};}
 return {ok:status.graded>0&&status.blocked===0,...status};
}
