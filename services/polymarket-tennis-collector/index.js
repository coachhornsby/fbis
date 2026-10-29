import {requireJobAdmission} from '../account-budget/admission.mjs';
import {createExecutionLease,executionEnv} from '../account-budget/execution.mjs';
import {POLY_US_API} from '../../functions/lib/polymarketUs.js';
import {CERTIFIED_EXECUTION_JOBS,TENNIS_COLLECT_JOB as JOB} from '../account-budget/executionJobs.mjs';
export const TENNIS_JOB_CEILINGS=CERTIFIED_EXECUTION_JOBS[JOB].units;
const HEALTH_CEILINGS=CERTIFIED_EXECUTION_JOBS[JOB+':health'].units;
async function begin(env,{health=false}={}){
 const admitted=await requireJobAdmission(env,JOB+(health?':health':''),crypto.randomUUID());
 const ceilings=health?HEALTH_CEILINGS:TENNIS_JOB_CEILINGS;
 const maxUnits=Object.fromEntries(Object.entries(ceilings).map(([key,cap])=>[key,Number.isSafeInteger(admitted.maxUnits?.[key])&&admitted.maxUnits[key]>=0?Math.min(cap,admitted.maxUnits[key]):0]));
 const lease=createExecutionLease({...admitted,maxUnits});
 return executionEnv(env,lease,{network:{origin:new URL(POLY_US_API).origin,path:'/v1/events'}});
}
/**
 * Bounded Polymarket US Tennis research capture; schedules remain paused.
 * This is a Cloudflare Cron source collector, not a Pages request or
 * any wager/order route. No ESPN, PinnOdds, or private account credentials.
 */
import {collectPolymarketUsTennisInventory}
  from "../../functions/lib/tennisExchangeInventory.js";
const STATUS="tennis/exchange-inventory/collector-status-v1.json";
const respond=(data,status=200)=>Response.json(data,{status,headers:{
  "cache-control":"no-store","x-content-type-options":"nosniff"}});
export async function collectTennisOnSchedule(env,{now=new Date(),fetchImpl=env.FBIS_JOB_FETCH}={}){
 if(typeof fetchImpl!=="function")throw Error("JOB_EXECUTION_BOUNDARY_REQUIRED");
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
 try{env=await begin(env);}catch{return;}

  ctx.waitUntil(collectTennisOnSchedule(env));
 },
 async fetch(request,env){

  const url=new URL(request.url);
  if(request.method!=="GET"||url.pathname!=="/health")
    return respond({ok:false,code:"READ_ONLY_HEALTH_ONLY"},404);
 try{env=await begin(env,{health:true});}catch{return respond({ok:false,code:"ACCOUNT_BUDGET_STOP",paused:true},503);}
  let status=null;
  try{
    const stored=await env.ARCHIVE.get(STATUS);
    if(stored)status=await stored.json();
  }catch{return respond({ok:false,code:"R2_STATUS_UNAVAILABLE"},503);}
  return respond({ok:true,readOnly:true,snapshotSource:"R2",
    schedule:String(env.FBIS_TENNIS_SCHEDULE||"PAUSED"),collector:"CLOUDFLARE_CRON_R2",
    lastAttemptAt:status?.attemptedAt||null,
    lastCompletedAt:status?.completedAt||null,
    lastStatus:status?.status||"AWAITING_FIRST_CRON",
    atp:status?.atp??null,wta:status?.wta??null,
    sourceErrors:status?.errors||[],
    canQualify:false,canAuthorizeWager:false});
 }
};