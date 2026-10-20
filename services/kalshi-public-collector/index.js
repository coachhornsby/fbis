import { getKalshiShadowMarkets } from "../../functions/lib/kalshiMarketShadow.js";

/**
 * Public Kalshi collector. Single scheduled Worker; R2 public observations only.
 * No Kalshi API key, account data, D1 writes, model authority, or trade methods.
 */
const PREFIX="kalshi/public-shadow/v1/";
const SPORTS=["nfl","cfb"]; // MLB/NBA and other sports blocked pending series/coverage.
const SLOT_MS=15*60*1000;
const BASE_BACKOFF_MS=60*60*1000;
const parsedTime=v=>Number.isFinite(Date.parse(v||""))?Date.parse(v):0;
const nowIso=d=>d.toISOString();

async function readJson(bucket,key){
  if(!bucket?.get)return null;
  try{const x=await bucket.get(PREFIX+key);return x?await x.json():null;}catch{return null;}
}
async function writeJson(bucket,key,body){
  await bucket.put(PREFIX+key,JSON.stringify(body),{
    httpMetadata:{contentType:"application/json",cacheControl:"private, max-age=0"},
  });
}
export function selectedSport(time){
  return SPORTS[Math.floor(time.getTime()/SLOT_MS)%SPORTS.length];
}
export async function collectKalshiPublicOnce(env,{now=new Date(),fetchImpl=fetch}={}){
  if(!env?.ARCHIVE?.put||!env?.ARCHIVE?.get)return {ok:false,code:"ARCHIVE_BINDING_MISSING"};
  const last=await readJson(env.ARCHIVE,"collector-status.json");
  if(parsedTime(last?.blockedUntil)>now.getTime()){
    return {ok:false,code:"KALSHI_PUBLIC_COOLDOWN",blockedUntil:last.blockedUntil};
  }
  const sport=selectedSport(now);
  const data=await getKalshiShadowMarkets(sport,{fetchImpl,now,limit:80});
  const result={
    source:"Kalshi",collector:"SCHEDULED_WORKER_R2",sport,attemptedAt:nowIso(now),
    status:data.ok?"CAPTURED":data.rateLimited?"RATE_LIMITED":"ERROR",
    code:data.ok?null:data.code,rateLimited:!!data.rateLimited,
    httpStatus:data.httpStatus||null,records:data.ok?data.records.length:0,
    paginationComplete:data.ok?data.paginationComplete:false,
    canQualify:false,canAuthorizeWager:false,canWriteMarketHistory:false,
  };
  let blockedUntil=null;
  if(data.rateLimited){
    const seconds=Math.max(3600,Number(data.retryAfterSeconds)||0);
    blockedUntil=new Date(now.getTime()+Math.min(14400,seconds*1000)).toISOString();
  } else if(!data.ok) {
    blockedUntil=new Date(now.getTime()+BASE_BACKOFF_MS).toISOString();
  }
  await writeJson(env.ARCHIVE,"collector-status.json",{...result,blockedUntil});
  if(data.ok){
    // Successful data is immutable from the user's perspective until a new
    // healthy snapshot replaces it. Old R2 snapshots are never labeled fresh.
    await writeJson(env.ARCHIVE,"sports/"+sport+".json",{
      ...data,collector:"SCHEDULED_WORKER_R2",
      capturedAt:nowIso(now),cacheScope:"CENTRAL_R2_READ_ONLY",
      canQualify:false,canAuthorizeWager:false,
    });
  }
  return {...result,blockedUntil};
}
export default {
  async scheduled(_event,env,ctx){
    ctx.waitUntil(collectKalshiPublicOnce(env));
  },
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method!=="GET"||url.pathname!=="/health"){
      return new Response(JSON.stringify({ok:false,code:"READ_ONLY_HEALTH_ONLY"}),{
        status:404,headers:{"content-type":"application/json","cache-control":"no-store"}
      });
    }
    const status=await readJson(env.ARCHIVE,"collector-status.json");
    return Response.json({ok:true,readOnly:true,snapshotSource:"R2",status:status?.status||"NOT_STARTED",
      sport:status?.sport||null,lastAttemptAt:status?.attemptedAt||null,
      blockedUntil:status?.blockedUntil||null,
      // No private financial or account information in health.
      canQualify:false,canAuthorizeWager:false,
    },{headers:{"cache-control":"no-store"}});
  },
};
