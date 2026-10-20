/**
 * Conservative Kalshi public snapshot throttle for Pages.
 *
 * Cloudflare's Cache API is per-colo, not a globally coordinated rate budget.
 * This avoids same-colo fanout, shares 429 cooldown with all public sports in
 * that colo, and does not claim global or verified source availability.
 * Deploy a Durable Object central collector before automatic page fanout.
 */
import { getKalshiShadowMarkets, getKalshiShadowBook } from "./kalshiMarketShadow.js";
const PREFIX="https://fbis-kalshi-cache.invalid/";
const SNAPSHOT_SECONDS=90;
const RATE_LIMIT_SECONDS=180;
function safeUrl(part){return new Request(PREFIX+part);}
function cacheKey(sport,ticker=""){
  return safeUrl("v2/"+sport+"/"+(ticker?"book/"+ticker:"markets"));
}
function parseCache(res){
  return res.json().catch(()=>null);
}
async function readShared(cache,key) {
  if(!cache?.match)return null;
  try {
    const r=await cache.match(key);
    return r?await parseCache(r):null;
  }catch{return null;}
}
async function writeShared(cache,key,obj,seconds,waitUntil){
  if(!cache?.put)return;
  try{
    const promise=cache.put(key,new Response(JSON.stringify(obj),{
      headers:{"content-type":"application/json","cache-control":"public, max-age="+seconds},
    }));
    if(typeof waitUntil==="function")waitUntil(promise.catch(()=>{}));
    else await promise;
  }catch{}
}
export async function cachedKalshiShadow({sport,ticker=null,cache=null,waitUntil,fetchImpl=fetch,now=new Date()}={}){
  const validSport=["nfl","cfb","nba","mlb"].includes(sport);
  if(!validSport)return {ok:false,code:"KALSHI_SERIES_NOT_QUALIFIED"};
  // Shared per-colo breaker; one 429 blocks all sport attempts during cooldown.
  const cooldown=await readShared(cache,safeUrl("v2/upstream-cooldown"));
  if(cooldown?.blockedUntil && Number.isFinite(Date.parse(cooldown.blockedUntil))
    && Date.parse(cooldown.blockedUntil)>now.getTime()){
    return {ok:false,code:"KALSHI_PUBLIC_RATE_LIMITED",httpStatus:429,rateLimited:true,
      retryAfterSeconds:Math.ceil((Date.parse(cooldown.blockedUntil)-now.getTime())/1000),
      collector:"EDGE_CACHE_COOLDOWN",cacheScope:"EDGE_COLO_NOT_GLOBAL"};
  }
  const key=cacheKey(sport,ticker);
  const cached=await readShared(cache,key);
  if(cached?.ok&&cached?.fetchedAt && Date.parse(cached.fetchedAt)<=now.getTime()
    && now.getTime()-Date.parse(cached.fetchedAt)<=SNAPSHOT_SECONDS*1000){
    return {...cached,collector:"EDGE_CACHE_HIT",cacheScope:"EDGE_COLO_NOT_GLOBAL"};
  }
  const result=ticker
    ?await getKalshiShadowBook(sport,ticker,{fetchImpl,now})
    :await getKalshiShadowMarkets(sport,{fetchImpl,now,limit:80});
  if(result.rateLimited) {
    const seconds=Math.min(900,Math.max(60,Number(result.retryAfterSeconds)||RATE_LIMIT_SECONDS));
    await writeShared(cache,safeUrl("v2/upstream-cooldown"),{
      blockedUntil:new Date(now.getTime()+seconds*1000).toISOString(),
    },seconds,waitUntil);
    return {...result,collector:"UPSTREAM_429",cacheScope:"EDGE_COLO_NOT_GLOBAL"};
  }
  if(result.ok) {
    const record={...result,collector:"EDGE_CACHE_MISS",cacheScope:"EDGE_COLO_NOT_GLOBAL"};
    await writeShared(cache,key,record,SNAPSHOT_SECONDS,waitUntil);
    return record;
  }
  return {...result,collector:"UPSTREAM_ERROR",cacheScope:"EDGE_COLO_NOT_GLOBAL"};
}
