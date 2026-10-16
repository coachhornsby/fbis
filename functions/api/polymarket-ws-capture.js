import {authorizeHarvest} from "../lib/auth.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
/**
 * Retired duplicate six-second WebSocket sampler. The persistent Durable Object
 * stream is the sole owner of authenticated market subscriptions and BBO writes.
 * Keep this authenticated endpoint as an explicit migration signal so stale
 * callers cannot silently create parallel sockets/provider traffic.
 */
export async function onRequestPost({request,env}){
 if(!authorizeHarvest(request,env).ok) return json({ok:false,reason:"unauthorized"},403);
 return json({ok:false,reason:"RETIRED_DUPLICATE_COLLECTOR",
  replacement:"fbis-polymarket-us-stream /health",
  noProviderRequest:true,canAuthorizeWager:false},410);
}
export async function onRequestGet(){return json({ok:false,reason:"method-not-allowed"},405)}
