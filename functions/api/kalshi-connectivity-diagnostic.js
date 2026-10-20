import {runKalshiConnectivityDiagnostic} from "../lib/kalshiConnectivityDiagnostic.js";
const reply=(body,status=200)=>Response.json(body,{
  status,headers:{
    "cache-control":"private, no-store, max-age=0",
    "pragma":"no-cache","x-robots-tag":"noindex, nofollow",
    "x-content-type-options":"nosniff",
  },
});
async function isAuthorized(expected,actual,subtle=crypto.subtle){
  if(typeof expected!=="string"||!expected||typeof actual!=="string"
    ||!actual||actual.length>512)return false;
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([
    subtle.digest("SHA-256",enc.encode(expected)),
    subtle.digest("SHA-256",enc.encode(actual)),
  ]);
  const left=new Uint8Array(a),right=new Uint8Array(b);
  let mismatch=0;
  for(let i=0;i<left.length;i++)mismatch|=left[i]^right[i];
  return mismatch===0;
}
/**
 * POST is a read-only connectivity *probe*, not a trade action.
 * All upstream calls are GET-only. No user account data is returned.
 */
export async function onRequestPost({request,env,fetchImpl=fetch,webCrypto=crypto}){
  if(!env?.FBIS_ACCOUNT_VIEW_TOKEN)
    return reply({ok:false,code:"PORTFOLIO_ACCESS_NOT_CONFIGURED"},503);
  if(!await isAuthorized(env.FBIS_ACCOUNT_VIEW_TOKEN,
    request.headers.get("x-fbis-account-token"),webCrypto.subtle))
    return reply({ok:false,code:"PORTFOLIO_ACCESS_DENIED"},403);
  const sport=(new URL(request.url).searchParams.get("sport")||"nfl").toLowerCase();
  if(!["nfl","cfb"].includes(sport))
    return reply({ok:false,code:"SPORT_NOT_ALLOWED"},400);
  try{
    const result=await runKalshiConnectivityDiagnostic(env,{
      sport,fetchImpl,webCrypto,
    });
    return reply(result,result.ok?200:503);
  }catch{
    return reply({ok:false,code:"CONNECTIVITY_CHECK_UNAVAILABLE"},503);
  }
}
export async function onRequestGet(){return reply({ok:false,code:"OPERATOR_POST_REQUIRED"},405);}
