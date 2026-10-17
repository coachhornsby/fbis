import {authorizeHarvest, unauthorizedBody} from '../lib/auth.js';
import {collegeApiKey} from '../lib/collegeSecrets.js';
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
// Account metadata only: never acquire sports records or clear the exhaustion gate.
export async function onRequestPost({request,env}) {
  if(!authorizeHarvest(request,env).ok)return respond(unauthorizedBody(),403);
  const key=collegeApiKey(env,'cfbd');
  if(!key)return respond({ok:false,error:'provider-credential-missing',collectionStarted:false},503);
  try {
    const r=await fetch('https://api.collegefootballdata.com/info',{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
    let b=null;try{b=await r.json();}catch{}
    const verified=r.ok&&Number.isFinite(b?.remainingCalls)&&b.remainingCalls>=0;
    return respond({ok:verified,checkedAt:new Date().toISOString(),endpoint:'/info',httpStatus:r.status,
      tierName:b?.tierName??null,monthlyLimit:b?.monthlyLimit??null,remainingCalls:b?.remainingCalls??null,
      usedCalls:b?.usedCalls??null,resetAt:b?.resetAt??null,sharedPool:b?.sharedPool??null,
      allowanceVerified:verified,collectionStarted:false,quotaAcknowledged:false},verified?200:502);
  }catch{return respond({ok:false,error:'provider-allowance-unavailable',collectionStarted:false},502);}
}
