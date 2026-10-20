const respond=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private,no-store','x-content-type-options':'nosniff'}});
/** Standalone research-only, separate from existing manual bet-card learning API. */
export async function onRequestGet({env}){
 if(!env?.ARCHIVE?.get)return respond({ok:false,status:'LEARNING_ARCHIVE_UNAVAILABLE',canAuthorizeWager:false},503);
 try {
  const obj=await env.ARCHIVE.get('player-props/learning/v1/nhl-projection-accuracy.json');
  if(!obj)return respond({ok:true,status:'NOT_YET_OBSERVED',cohorts:[],verifiedPairs:0,
   realizedProfit:null,canQualify:false,canAuthorizeWager:false});
  const raw=await obj.json();
  if(raw?.version!==1||!Array.isArray(raw.cohorts))return respond({ok:false,status:'LEARNING_REPORT_INVALID',canAuthorizeWager:false},503);
  return respond({ok:true,sport:'nhl',asOf:raw.asOf,status:raw.status,
   verifiedPairs:raw.verifiedPairs,pendingResults:raw.pendingResults,rejected:raw.rejected,
   cohorts:raw.cohorts,scope:'PROJECTION_ERROR_ONLY',
   probabilityCalibration:null,clv:null,realizedProfit:null,
   canQualify:false,canAuthorizeWager:false});
 }catch{return respond({ok:false,status:'LEARNING_REPORT_READ_FAILED',canAuthorizeWager:false},503);}
}
