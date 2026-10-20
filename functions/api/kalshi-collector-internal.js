import {captureKalshiComboTape} from "../lib/kalshiComboTape.js";
import {captureKalshiMultilegs} from "../lib/kalshiMultilegCollector.js";
import {captureKalshiTargetedEvidence} from "../lib/kalshiTargetedEvidence.js";
import { captureKalshiPlayerProps } from "../lib/kalshiPlayerPropCollector.js";
import {
  captureSignedKalshiMarkets,captureSignedKalshiExchangeStatus,
  captureKalshiSportsSeriesCatalog,
} from "../lib/kalshiSignedCollector.js";
const respond=(obj,status=200)=>Response.json(obj,{
  status,headers:{"cache-control":"private, no-store","pragma":"no-cache",
    "x-content-type-options":"nosniff","x-robots-tag":"noindex, nofollow"},
});
async function authorized(expected,provided,subtle){
  if(typeof expected!=="string"||expected.length<40
    ||typeof provided!=="string"||provided.length!==expected.length
    ||provided.length>256)return false;
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([
    subtle.digest("SHA-256",enc.encode(expected)),
    subtle.digest("SHA-256",enc.encode(provided)),
  ]);
  const x=new Uint8Array(a),y=new Uint8Array(b);
  let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
  return diff===0;
}
/**
 * Worker-to-Pages service endpoint, NOT an operator-facing diagnostic.
 * Caller uses independent service token (never Kalshi key) from encrypted
 * Cloudflare bindings. No browser access, GET-only Kalshi queries, R2 only.
 */
export async function onRequestPost({request,env,fetchImpl=fetch,webCrypto=crypto}){
  const token=request.headers.get("x-fbis-kalshi-relay-token");
  if(!await authorized(env?.FBIS_KALSHI_RELAY_TOKEN,token,webCrypto.subtle))
    return respond({ok:false,code:"INTERNAL_COLLECTOR_ACCESS_DENIED"},403);
  const u=new URL(request.url);
  const scope=u.searchParams.get("scope");
  if(scope==="player-props"){
    try { const r=await captureKalshiPlayerProps(env,{fetchImpl,webCrypto});return respond(r,r.ok?200:503); }
    catch { return respond({ok:false,code:"PLAYER_PROP_COLLECTION_UNAVAILABLE"},503); }
  }
  if(scope==="markets"){
    const sport=u.searchParams.get("sport");
    if(!["nfl","cfb","atp","wta"].includes(sport))
      return respond({ok:false,code:"KALSHI_SPORT_NOT_ENABLED"},400);
    try{
      const result=await captureSignedKalshiMarkets(env,{sport,fetchImpl,webCrypto});
      return respond(result,result.ok?200:result.code==="KALSHI_PUBLIC_RATE_LIMITED"?429:503);
    }catch{
      return respond({ok:false,code:"SIGNED_COLLECTION_UNAVAILABLE"},503);
    }
  }
  if(scope==="qualification-evidence"){
    try{const r=await captureKalshiTargetedEvidence(env,{fetchImpl,webCrypto});return respond(r,r.ok?200:503)}
    catch{return respond({ok:false,code:"EVIDENCE_COLLECTION_UNAVAILABLE"},503)}
  }
  if(scope==="combo-tape"){
    try{const r=await captureKalshiComboTape(env,{fetchImpl});return respond(r,r.ok?200:503)}
    catch{return respond({ok:false,code:"COMBO_TAPE_UNAVAILABLE"},503)}
  }
  if(scope==="multilegs"){
    try{const r=await captureKalshiMultilegs(env,{fetchImpl});return respond(r,r.ok?200:503)}
    catch{return respond({ok:false,code:"MULTILEG_COLLECTION_UNAVAILABLE"},503)}
  }
  if(scope==="exchange-status"){
    try{
      const result=await captureSignedKalshiExchangeStatus(env,{fetchImpl,webCrypto});
      return respond(result,result.ok?200:503);
    }catch{
      return respond({ok:false,code:"SIGNED_STATUS_UNAVAILABLE"},503);
    }
  }
  if(scope==="series-catalog"){
    try{
      const result=await captureKalshiSportsSeriesCatalog(env,{fetchImpl,webCrypto});
      return respond(result,result.ok?200:result.code==="KALSHI_CATALOG_POLL_NOT_DUE"?200:503);
    }catch{
      return respond({ok:false,code:"KALSHI_CATALOG_UNAVAILABLE"},503);
    }
  }
  return respond({ok:false,code:"COLLECTION_SCOPE_NOT_ALLOWED"},400);
}
export async function onRequestGet(){return respond({ok:false,code:"INTERNAL_POST_REQUIRED"},405);}
