/**
 * Public Polymarket US Tennis research capture, every five minutes.
 * This is a Cloudflare Cron source collector, not a Pages request or
 * any wager/order route. No ESPN, PinnOdds, or private account credentials.
 */
import {collectPolymarketUsTennisInventory}
  from "../../functions/lib/tennisExchangeInventory.js";
const STATUS="tennis/exchange-inventory/collector-status-v1.json";
const respond=(data,status=200)=>Response.json(data,{status,headers:{
  "cache-control":"no-store","x-content-type-options":"nosniff"}});
export async function collectTennisOnSchedule(env,{now=new Date(),fetchImpl=fetch}={}){
 const attemptedAt=now.toISOString();
 let receipt;
 try{
  const collected=await collectPolymarketUsTennisInventory(env,{now,fetchImpl});
  receipt={source:"Polymarket US",collector:"CLOUDFLARE_CRON_R2",
    attemptedAt,completedAt:new Date().toISOString(),
    status:collected.ok?(collected.complete?"CAPTURED":"PARTIAL"):"FAILED",
    atp:collected.atp,wta:collected.wta,events:collected.events,
    sources:collected.sources,errors:collected.errors,
    canQualify:false,canAuthorizeWager:false};
 }catch(error){
  receipt={source:"Polymarket US",collector:"CLOUDFLARE_CRON_R2",
    attemptedAt,completedAt:new Date().toISOString(),status:"FAILED",
    errorCode:String(error?.message||error).slice(0,120),
    canQualify:false,canAuthorizeWager:false};
 }
 try{
  await env.ARCHIVE.put(STATUS,JSON.stringify(receipt),{
    httpMetadata:{contentType:"application/json"}});
 }catch{
  return {...receipt,status:"STATUS_WRITE_FAILED"};
 }
 return receipt;
}
export default {
 async scheduled(_event,env,ctx){
  ctx.waitUntil(collectTennisOnSchedule(env));
 },
 async fetch(request,env){
  const url=new URL(request.url);
  if(request.method!=="GET"||url.pathname!=="/health")
    return respond({ok:false,code:"READ_ONLY_HEALTH_ONLY"},404);
  let status=null;
  try{
    const stored=await env.ARCHIVE.get(STATUS);
    if(stored)status=await stored.json();
  }catch{return respond({ok:false,code:"R2_STATUS_UNAVAILABLE"},503);}
  return respond({ok:true,readOnly:true,snapshotSource:"R2",
    schedule:"EVERY_5_MINUTES",collector:"CLOUDFLARE_CRON_R2",
    lastAttemptAt:status?.attemptedAt||null,
    lastCompletedAt:status?.completedAt||null,
    lastStatus:status?.status||"AWAITING_FIRST_CRON",
    atp:status?.atp??null,wta:status?.wta??null,
    sourceErrors:status?.errors||[],
    canQualify:false,canAuthorizeWager:false});
 }
};