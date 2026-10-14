const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestGet({env}){
 if(!env.ARCHIVE?.get)return json({ok:false,error:'ARCHIVE_UNAVAILABLE'},503);
 const scopes=[];for(const sportId of [1,2,3,4,5,6])for(const feed of ['prematch','live'])scopes.push({kind:'board',sportId,feed});
 scopes.push({kind:'health'});for(const feed of ['prematch','live'])scopes.push({kind:'drops',feed});
 const results=await Promise.all(scopes.map(async scope=>{
  try{const object=await env.ARCHIVE.get(`market-sources/pinnodds/latest/${scope.kind}-${scope.sportId||'all'}-${scope.feed||'all'}.json`);if(!object)return{...scope,status:'NOT_CAPTURED'};const receipt=await object.json();
   const ageMs=Date.now()-Date.parse(receipt.collectedAt),result={...scope,status:ageMs>=0&&ageMs<=7*3600000?'RECENT_CAPTURE':'STALE_CAPTURE',collectedAt:receipt.collectedAt,
    snapshotId:receipt.snapshotId||null,
    providerStatus:receipt.providerStatus,providerEventCount:receipt.providerEventCount,normalizedRows:receipt.normalizedRows,matchedRows:receipt.matchedRows,reconciled:receipt.reconciled,reasons:receipt.reasons,
    rematched:receipt.rematched===true,paidProviderCall:receipt.paidProviderCall===true?true:receipt.paidProviderCall===false?false:null,
    providerQuoteClockVerified:false,dropBufferComplete:receipt.dropBufferComplete};
   if(scope.kind==='health'){const raw=await env.ARCHIVE.get(receipt.rawKey);const health=raw?await raw.json():{};result.providerFeedHealth={live:health.status||'unknown',prematch:health.prematch?.status||'unknown',liveWriteAgeMs:health.live_write_age_ms??null,prematchWriteAgeMs:health.prematch?.write_age_ms??null};}
   return result;
  }catch{return{...scope,status:'STATUS_READ_ERROR'};}
 }));
 return json({ok:true,source:'PinnOdds',scope:'SIX_SUPPORTED_PROVIDER_SPORTS_ALL_RETURNED_MARKETS_AND_PERIODS',fullBoardCadenceHours:6,dropBufferCadenceHours:3,
  currentQuotesVerified:false,fullMarketCoverageVerified:false,results,readOnly:true,canAuthorizeWager:false});
}
