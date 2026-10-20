/**
 * Authenticated public-market capture inside the Pages runtime, which already
 * has the working Kalshi Ed25519 key as an encrypted binding.
 *
 * No private account fields, signing headers, order methods, or credentials
 * are written to R2 or returned to the scheduled Worker.
 */
import { getKalshiShadowMarketsPaged, KALSHI_SHADOW_SERIES } from "./kalshiMarketShadow.js";
import { fetchKalshiExchangeStatus } from "./kalshiExchangeStatus.js";
import {
  kalshiSignedHeaders, kalshiPrivateKeyPem, KALSHI_BASE,
  KALSHI_DIAGNOSTIC_PATHS,
} from "./kalshiAccount.js";

const ROOT="kalshi/public-shadow/v1/";
const SPACING_MS=15*60*1000;
const STATUS_SPACING_MS=60*60*1000;
const SOURCE="SIGNED_PAGES";
const iso=d=>d.toISOString();
const ms=value=>Number.isFinite(Date.parse(value||""))?Date.parse(value):0;
async function readJson(bucket,path){
  try{const x=await bucket.get(ROOT+path);return x?await x.json():null;}catch{return null;}
}
async function writeJson(bucket,path,obj){
  await bucket.put(ROOT+path,JSON.stringify(obj),{
    httpMetadata:{contentType:"application/json",cacheControl:"private, max-age=0"},
  });
}
export function kalshiSignedReadProxy(env,{fetchImpl=fetch,now=Date.now(),webCrypto=crypto}={}){
  return async (url,options={})=>{
    const uri=new URL(url);
    const allowed=new Set(Object.values(KALSHI_DIAGNOSTIC_PATHS));
    if(uri.origin!==KALSHI_BASE||!allowed.has(uri.pathname)||options.method!=="GET")
      throw new Error("KALSHI_SIGNED_RELAY_PATH_BLOCKED");
    const headers=await kalshiSignedHeaders({
      keyId:env.KALSHI_API_KEY_ID,privateKeyPem:kalshiPrivateKeyPem(env),
      path:uri.pathname,method:"GET",timestamp:now,webCrypto,
    });
    // Redirects must NEVER send Kalshi signed headers to another host.
    return fetchImpl(uri.toString(),{
      method:"GET",headers:{accept:"application/json",...headers},
      redirect:"manual",signal:options.signal||AbortSignal.timeout(12000),
    });
  };
}
export async function captureSignedKalshiMarkets(env,{sport="nfl",now=new Date(),
  fetchImpl=fetch,webCrypto=crypto}={}){
  if(!Object.prototype.hasOwnProperty.call(KALSHI_SHADOW_SERIES,sport)
    ||!["nfl","cfb"].includes(sport))
    return {ok:false,code:"KALSHI_SPORT_NOT_ENABLED"};
  if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)
    return {ok:false,code:"ARCHIVE_BINDING_MISSING"};
  if(!env.KALSHI_API_KEY_ID||!kalshiPrivateKeyPem(env))
    return {ok:false,code:"KALSHI_SIGNING_CREDENTIALS_NOT_CONFIGURED"};
  const previous=await readJson(env.ARCHIVE,"collector-status.json");
  if(previous?.authenticationMode===SOURCE){
    if(ms(previous.blockedUntil)>now.getTime())
      return {ok:false,code:"KALSHI_SIGNED_COOLDOWN",blockedUntil:previous.blockedUntil};
    if(ms(previous.attemptedAt)>now.getTime()-SPACING_MS)
      return {ok:false,code:"KALSHI_SIGNED_POLL_NOT_DUE",lastAttemptAt:previous.attemptedAt};
  }
  const proxy=kalshiSignedReadProxy(env,{fetchImpl,now:now.getTime(),webCrypto});
  const data=await getKalshiShadowMarketsPaged(sport,{fetchImpl:proxy,now,pageLimit:100,maxPages:4});
  let blockedUntil=null;
  if(data.rateLimited){
    blockedUntil=iso(new Date(now.getTime()+60*60*1000));
  }else if(!data.ok){
    blockedUntil=iso(new Date(now.getTime()+15*60*1000));
  }
  const status={
    source:"Kalshi",collector:"SCHEDULED_WORKER_R2",authenticationMode:SOURCE,
    sport,attemptedAt:iso(now),
    status:data.ok?"CAPTURED":data.rateLimited?"RATE_LIMITED":"ERROR",
    code:data.ok?null:data.code,httpStatus:data.httpStatus||null,
    rateLimited:!!data.rateLimited,records:data.ok?data.records.length:0,
    paginationComplete:data.ok?data.paginationComplete:false,
    pagesFetched:data.pagesFetched||0,
    invalidRows:data.ok?data.invalidRows:0,
    blockedUntil,
    canQualify:false,canAuthorizeWager:false,canWriteMarketHistory:false,
  };
  await writeJson(env.ARCHIVE,"collector-status.json",status);
  if(data.ok){
    await writeJson(env.ARCHIVE,"sports/"+sport+".json",{
      ...data,collector:"SCHEDULED_WORKER_R2",authenticationMode:SOURCE,
      capturedAt:iso(now),cacheScope:"CENTRAL_R2_READ_ONLY",
      canQualify:false,canAuthorizeWager:false,
    });
  }
  return {ok:data.ok,...status};
}
export async function captureSignedKalshiExchangeStatus(env,{now=new Date(),
  fetchImpl=fetch,webCrypto=crypto}={}){
  if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)
    return {ok:false,code:"ARCHIVE_BINDING_MISSING"};
  if(!env.KALSHI_API_KEY_ID||!kalshiPrivateKeyPem(env))
    return {ok:false,code:"KALSHI_SIGNING_CREDENTIALS_NOT_CONFIGURED"};
  const previous=await readJson(env.ARCHIVE,"exchange-status.json");
  if(previous?.authenticationMode===SOURCE
    &&ms(previous.nextAllowedAt)>now.getTime())
    return {ok:false,code:"KALSHI_STATUS_POLL_NOT_DUE",nextAllowedAt:previous.nextAllowedAt};
  const proxy=kalshiSignedReadProxy(env,{fetchImpl,now:now.getTime(),webCrypto});
  const result=await fetchKalshiExchangeStatus({fetchImpl:proxy,now});
  const status={
    source:"Kalshi",endpoint:"/exchange/status",authenticationMode:SOURCE,
    observedAt:iso(now),
    state:result.ok?"VERIFIED":result.rateLimited?"RATE_LIMITED":"UNAVAILABLE",
    code:result.ok?null:result.code,
    httpStatus:result.httpStatus||null,
    exchange:result.ok?result.status:null,
    nextAllowedAt:iso(new Date(now.getTime()+
      (result.rateLimited?2*STATUS_SPACING_MS:STATUS_SPACING_MS))),
    canQualify:false,canAuthorizeWager:false,
  };
  await writeJson(env.ARCHIVE,"exchange-status.json",status);
  return {ok:result.ok,state:status.state,code:status.code,observedAt:status.observedAt};
}
