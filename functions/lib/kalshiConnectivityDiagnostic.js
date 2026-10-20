import {
  kalshiPrivateKeyPem, kalshiSignedHeaders, KALSHI_BASE,
  KALSHI_DIAGNOSTIC_PATHS,
} from "./kalshiAccount.js";
import { KALSHI_SHADOW_SERIES } from "./kalshiMarketShadow.js";

const ROOT="kalshi/public-shadow/v1/connectivity-diagnostics/";
const MIN_GAP_MS=15*60*1000;
const nowIso=d=>d.toISOString();
const numericStatus=v=>Number.isInteger(v)&&v>=100&&v<=599?v:null;

async function doGet(url,headers,fetchImpl){
  try{
    const response=await fetchImpl(url,{
      method:"GET",headers,redirect:"error",cache:"no-store",
      signal:AbortSignal.timeout(11000),
    });
    // Provider bodies, cookies, account details, request signatures, and
    // response headers are intentionally never returned or stored.
    return {httpStatus:numericStatus(response.status),
      result:response.ok?"HTTP_OK":response.status===429?"RATE_LIMITED":
        response.status===401||response.status===403?"ACCESS_DENIED":"HTTP_ERROR"};
  }catch{
    return {httpStatus:null,result:"CONNECTION_FAILED"};
  }
}
async function load(bucket,key){
  try{const o=await bucket.get(ROOT+key);return o?await o.json():null;}catch{return null;}
}
async function save(bucket,key,data){
  await bucket.put(ROOT+key,JSON.stringify(data),{
    httpMetadata:{contentType:"application/json",cacheControl:"private, max-age=0"},
  });
}
export function diagnoseConnectivityStatuses(guest,signed){
  if(guest?.httpStatus===429&&signed?.result==="HTTP_OK")
    return "ANONYMOUS_RATE_LIMIT_AUTHENTICATED_ACCEPTED";
  if(guest?.httpStatus===403&&signed?.result==="HTTP_OK")
    return "ANONYMOUS_FORBIDDEN_AUTHENTICATED_ACCEPTED";
  if(guest?.result==="HTTP_OK"&&signed?.result==="HTTP_OK")
    return "BOTH_ACCEPTED";
  if(guest?.httpStatus===429&&signed?.httpStatus===429)
    return "BOTH_RATE_LIMITED";
  if(guest?.httpStatus===403&&signed?.httpStatus===403)
    return "BOTH_FORBIDDEN";
  if(signed?.httpStatus===401||signed?.httpStatus===403)
    return "SIGNED_AUTHENTICATION_OR_PERMISSION_REJECTED";
  if(guest?.result==="HTTP_OK"&&signed?.result!=="HTTP_OK")
    return "ANONYMOUS_ACCEPTED_SIGNED_UNAVAILABLE";
  return "INCONCLUSIVE";
}

/** Only called behind operator authorization, once per 15 minutes globally. */
export async function runKalshiConnectivityDiagnostic(env,{
  sport="nfl",now=new Date(),fetchImpl=fetch,webCrypto=crypto,
}={}){
  if(!["nfl","cfb"].includes(sport))return {ok:false,code:"SPORT_NOT_ALLOWED"};
  if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)
    return {ok:false,code:"DIAGNOSTIC_RATE_LIMIT_STORE_MISSING"};
  const old=await load(env.ARCHIVE,"global.json");
  const earliest=Date.parse(old?.nextAllowedAt||"");
  if(Number.isFinite(earliest)&&earliest>now.getTime()){
    return {
      ok:true,cached:true,rateLimitProtected:true,
      nextAllowedAt:old.nextAllowedAt,
      diagnosis:old.diagnosis||"PREVIOUS_RESULT_UNAVAILABLE",
      testedSport:old.testedSport||null,
      checkedAt:old.checkedAt||null,
      guest:old.guest||null,signed:old.signed||null,
      // Cached results are historical and never grant authority.
      canPublish:false,canQualify:false,canAuthorizeWager:false,
    };
  }
  if(!env.KALSHI_API_KEY_ID||!kalshiPrivateKeyPem(env))
    return {ok:false,code:"KALSHI_SIGNING_CREDENTIALS_NOT_CONFIGURED"};
  const path=KALSHI_DIAGNOSTIC_PATHS.markets;
  const url=new URL(KALSHI_BASE+path);
  url.searchParams.set("series_ticker",KALSHI_SHADOW_SERIES[sport]);
  url.searchParams.set("status","open");
  url.searchParams.set("limit","1");
  url.searchParams.set("mve_filter","exclude");
  let signedHeaders;
  try{
    signedHeaders=await kalshiSignedHeaders({
      keyId:env.KALSHI_API_KEY_ID,privateKeyPem:kalshiPrivateKeyPem(env),
      path,timestamp:now.getTime(),webCrypto,
    });
  }catch{
    return {ok:false,code:"KALSHI_SIGNING_FAILED"};
  }
  // Claim a global R2 cooldown before network I/O. R2 is not an atomic
  // lock, so simultaneous authorized callers might race; this is
  // best-effort operator throttling, never a hard request-rate guarantee.
  const checkedAt=nowIso(now);
  const nextAllowedAt=nowIso(new Date(now.getTime()+MIN_GAP_MS));
  await save(env.ARCHIVE,"global.json",{
    checkedAt,nextAllowedAt,testedSport:sport,diagnosis:"CHECK_IN_PROGRESS",
  });
  const guest=await doGet(url.toString(),{accept:"application/json"},fetchImpl);
  const signed=await doGet(url.toString(),{
    accept:"application/json",...signedHeaders,
  },fetchImpl);
  const diagnosis=diagnoseConnectivityStatuses(guest,signed);
  const receipt={
    checkedAt,nextAllowedAt,testedSport:sport,guest,signed,diagnosis,
  };
  await save(env.ARCHIVE,"global.json",receipt);
  return {
    ok:true,cached:false,rateLimitProtected:true,...receipt,
    canPublish:false,canQualify:false,canAuthorizeWager:false,
  };
}
