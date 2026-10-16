import {mirrorVerifiedWsObservations} from "../../functions/lib/marketHistoryWsShadow.js";
/** Persistent stream post-commit replicate with bounded per-request D1 work.
 * No canonical source deletions; the caller must durably queue IDs first.
 */
export const STREAM_SHADOW_CHUNK=16;
export async function mirrorPersistentStreamRows(env,ids,{mirror=mirrorVerifiedWsObservations}={}){
 if(env?.MARKET_HISTORY_SHADOW_WS!=="enabled")
   return {state:"OFF",attempted:0,verified:0,written:0};
 if(!Array.isArray(ids)||!ids.length||ids.length>40||
    ids.some(id=>!/^nmo_[0-9a-f]{28}$/.test(String(id))))throw Error("STREAM_SHADOW_INVALID_IDS");
 let verified=0,written=0;
 for(let i=0;i<ids.length;i+=STREAM_SHADOW_CHUNK){
  const chunk=ids.slice(i,i+STREAM_SHADOW_CHUNK);
  const r=await mirror(env,chunk);
  if(r.state!=="SHADOW_VERIFIED"||r.verified!==chunk.length||r.sourceRowsDeleted!==0)
    throw Error("STREAM_SHADOW_PARITY_FAILURE");
  verified+=r.verified;written+=r.written;
 }
 return {state:"SHADOW_VERIFIED",attempted:ids.length,verified,written,
  sourceRowsDeleted:0,primaryIsAuthoritative:true};
}
