import { reconcileOfficialProp } from './propOfficialReconciler.js';
export async function runApprovedPropReconciliation(env,{now=new Date(),webCrypto=globalThis.crypto}={}){
 if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)return {ok:false,reason:'ARCHIVE_UNBOUND'};
 let index;
 try{const f=await env.ARCHIVE.get('player-props/reconcile/v1/approved-index.json');index=f?await f.json():null;}
 catch{return {ok:false,reason:'INDEX_READ_FAILED'};}
 if(index?.version!==1||index.approved!==true||!Array.isArray(index.entries))
  return {ok:true,status:'NOT_CONFIGURED',canAuthorizeWager:false};
 const receipts=[];
 for(const row of index.entries.slice(0,8)){
  if(row?.reviewed!==true||![row.projectionId,row.marketId,row.resultId].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x))){
   receipts.push({ok:false,reason:'REVIEWED_EVIDENCE_REQUIRED'});continue;
  }
  try{
   const r=await reconcileOfficialProp(env,{...row,observedAt:now.toISOString(),webCrypto});
   receipts.push({ok:r.ok===true,reason:r.reason||null,gradeEvidenceId:r.gradeEvidenceId||null});
  }catch{receipts.push({ok:false,reason:'RECONCILIATION_FAILED'});}
 }
 const report={at:now.toISOString(),attempted:receipts.length,graded:receipts.filter(x=>x.ok).length,blocked:receipts.filter(x=>!x.ok).length,receipts,canAuthorizeWager:false};
 try{await env.ARCHIVE.put('player-props/reconcile/v1/latest-receipt.json',JSON.stringify(report));}
 catch{return {ok:false,reason:'RECEIPT_WRITE_FAILED',...report};}
 return {ok:report.blocked===0&&report.graded>0,...report};
}
