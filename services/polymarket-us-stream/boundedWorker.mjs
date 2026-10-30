import {DurableObject} from 'cloudflare:workers';
import {reserveJobExecution,beginJobExecution} from '../account-budget/jobScope.mjs';
import {POLY_STREAM_JOB as JOB} from '../account-budget/executionJobs.mjs';
import {runBoundedStream,STREAM_STATUS_KEY} from './boundedSession.mjs';
const OWNER='budgeted-markets-v1';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export class PolymarketMarketStreamRecovered extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.running=false;}
 async run(slot=Math.floor(Date.now()/900000)){
  const current=Math.floor(Date.now()/900000);
  if(!Number.isSafeInteger(slot)||(slot!==current&&slot!==current-1))return {ok:false,code:'INVALID_STREAM_SLOT'};
  if(this.ctx.id.toString()!==this.env.PM_STREAM.idFromName(OWNER).toString())return {ok:false,code:'LEGACY_OWNER_RETIRED'};
  if(this.running)return {ok:false,code:'SESSION_ALREADY_RUNNING'};
  this.running=true;
  try{
   const {env,lease}=await reserveJobExecution(this.env,JOB,{reservationId:'polyus-stream-'+slot,network:{origin:'https://fbis-myz.pages.dev',path:'/api/polymarket-stream-sign',method:'POST'}});
   return {ok:true,...await runBoundedStream(env,lease)};
  }catch{return {ok:false,code:'BOUNDED_STREAM_STOPPED'};}
  finally{this.running=false;}
 }
 // Legacy alarms never obtain a lease, perform collection or reschedule.
 async alarm(){await this.ctx.storage.deleteAlarm();}
 async fetch(){return json({ok:false,code:'NO_LEGACY_STREAM_ROUTES'},410);}
}
export default{
 async scheduled(event,env,ctx){
  // The DO owns concurrency and admission; public requests cannot start it.
  ctx.waitUntil(env.PM_STREAM.getByName(OWNER).run(Math.floor((event?.scheduledTime||Date.now())/900000)));
 },
 async fetch(request,env){
  const url=new URL(request.url);
  if(request.method!=='GET'||url.pathname!=='/health')return json({ok:false,code:'READ_ONLY_HEALTH_ONLY'},404);
  try{
   env=await beginJobExecution(env,JOB+':health');
   const object=await env.ARCHIVE.get(STREAM_STATUS_KEY),status=object?await object.json():null;
   return json({ok:true,readOnly:true,schedule:'PAUSED',continuous:false,status,canQualify:false,canAuthorizeWager:false});
  }catch{return json({ok:false,code:'ACCOUNT_BUDGET_STOP',paused:true},503);}
 }
};
