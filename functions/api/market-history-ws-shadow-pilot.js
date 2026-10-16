import {harvestSecret} from "../lib/auth.js";
import {mirrorVerifiedWsObservations} from "../lib/marketHistoryWsShadow.js";

/** Controlled POST-only source-preserving WebSocket shard smoke.
 * The live dual-writer flag stays OFF. Only a header-authenticated one-shot
 * probe may use a temporary in-request opt-in to validate at most 8 EXISTING
 * primary D1 records. No upstream websocket calls, orders or source deletes.
 */
const headers={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"private, no-store",
  "x-content-type-options":"nosniff",
};
const json=(data,status)=>new Response(JSON.stringify(data),{status,headers});
export async function onRequestPost(context){
 const expected=harvestSecret(context?.env);
 const supplied=context?.request?.headers?.get("x-harvest-secret");
 if(!expected||!supplied||supplied!==expected)return json({ok:false,error:"FORBIDDEN"},403);
 if(!context?.env?.DB?.prepare||!context?.env?.MARKET_HISTORY_DB?.prepare)
   return json({ok:false,error:"SHADOW_BINDING_UNAVAILABLE"},503);
 let body;
 try{body=await context.request.json()}catch{return json({ok:false,error:"INVALID_JSON"},400)}
 if(!body||body.operation!=="verifyExistingWsRows"||body.limit!==8||Object.keys(body).some(x=>!["operation","limit"].includes(x)))
   return json({ok:false,error:"INVALID_PILOT_CONTRACT"},400);
 try{
  const result=await context.env.DB.prepare(`SELECT id
    FROM normalized_market_observations
    WHERE source='Polymarket US WebSocket'
    AND can_qualify=0 AND can_authorize_wager=0
    ORDER BY rowid DESC LIMIT 8`).all();
  const ids=result?.results?.map(x=>x.id)||[];
  if(ids.length!==8)return json({ok:false,error:"INSUFFICIENT_CANONICAL_WS_ROWS"},409);
  const mirror=context.mirrorExistingWsRows||mirrorVerifiedWsObservations;
  // Per-request explicit verification only; never change Pages env vars.
  const verified=await mirror({...context.env,MARKET_HISTORY_SHADOW_WS:"enabled"},ids);
  if(verified.state!=="SHADOW_VERIFIED"||verified.verified!==8||verified.sourceRowsDeleted!==0)
    return json({ok:false,error:"SHADOW_VERIFICATION_UNAVAILABLE"},503);
  return json({ok:true,state:"SOURCE_PRESERVING_PILOT_VERIFIED",batchSize:8,
    attempted:verified.attempted,verified:verified.verified,written:verified.written,
    primaryIsAuthoritative:true,sourceRowsDeleted:0,liveShadowFlagEnabled:false,
    liveReadsRerouted:false,liveWritesRerouted:false,
    canQualify:false,canAuthorizeWager:false},200);
 }catch{
  return json({ok:false,error:"SHADOW_VERIFICATION_UNAVAILABLE",
   primaryIsAuthoritative:true,sourceRowsDeleted:0,canQualify:false,canAuthorizeWager:false},503);
 }
}
export async function onRequestGet(){return json({ok:false,error:"METHOD_NOT_ALLOWED"},405)}
