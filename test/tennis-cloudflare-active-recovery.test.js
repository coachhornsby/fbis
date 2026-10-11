import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  TENNIS_RECOVERY_CRON,
  selectTennisRecoveryScope,reviewRecentTennisRuns,recoverStaleTennis,
  runTennisRecoveryCron,
} from "../workers/tennis-refresh-recovery.mjs";
import {decideTennisRecoveryExecution} from "../scripts/tennis-refresh-recovery-gate.mjs";

const now=Date.parse("2026-10-11T05:57:00.000Z");
const health=(currentAge=145,fullAge=200,overrides={})=>({
  ok:currentAge<=115 && fullAge<=480,status:currentAge<=115 && fullAge<=480?"HEALTHY":"DEGRADED",
  scopes:[
    {scope:"current",state:currentAge>115?"STALE":"HEALTHY",ageMinutes:currentAge},
    {scope:"full",state:fullAge>480?"STALE":"HEALTHY",ageMinutes:fullAge},
  ],...overrides,
});
const config=()=>({TENNIS_RECOVERY_ENABLED:"true",TENNIS_GITHUB_DISPATCH_TOKEN:"fake-secret"});
function r2(){
  const data=new Map();
  return {
    data,
    async get(key){return data.has(key)?{json:async()=>JSON.parse(data.get(key))}:null;},
    async put(key,val){data.set(key,String(val));},
  };
}
function github({runs=[],postStatus=204}={}){
  const calls=[];
  async function request(url,opts={}){
    calls.push({url,method:opts.method||"GET",body:opts.body||null,headers:opts.headers});
    if(opts.method==="POST")return {status:postStatus,ok:postStatus===204};
    return {status:200,ok:true,json:async()=>({workflow_runs:runs})};
  }
  return {request,calls};
}

test("recovery recognizes misses before hard freshness SLA, but never invalid identities",()=>{
  assert.deepEqual(selectTennisRecoveryScope(health(65,130)),{scope:null,reason:"FRESH"});
  assert.equal(selectTennisRecoveryScope(health(100,130)).scope,"current");
  assert.equal(selectTennisRecoveryScope(health(125,430)).scope,"full");
  const bad=health(145,500);
  bad.scopes[0].state="INVALID";
  assert.equal(selectTennisRecoveryScope(bad).reason,"SOURCE_INTEGRITY_UNVERIFIED");
  assert.equal(selectTennisRecoveryScope(null).reason,"HEALTH_EVIDENCE_UNAVAILABLE");
});

test("only independent main-branch GitHub workflow runs block a recovery",()=>{
  const active={id:5,status:"in_progress",head_branch:"main",event:"schedule",created_at:new Date(now-120000).toISOString()};
  assert.equal(reviewRecentTennisRuns([active],now).reason,"GITHUB_REFRESH_ALREADY_RUNNING");
  assert.equal(reviewRecentTennisRuns([{...active,status:"completed",event:"workflow_dispatch"}],now).reason,"RECENT_DISPATCH_ALREADY_OBSERVED");
  assert.equal(reviewRecentTennisRuns([{...active,status:"completed",event:"schedule"}],now).blocked,false);
  assert.equal(reviewRecentTennisRuns([{...active,head_branch:"feature"}],now).blocked,false);
  assert.equal(reviewRecentTennisRuns(null,now).ok,false);
});

test("missing token never triggers GitHub calls or changes R2, even when stale",async()=>{
  const env={...config(),TENNIS_GITHUB_DISPATCH_TOKEN:"",R2_ARCHIVE:r2()};
  const api=github();
  const result=await recoverStaleTennis(env,{health:health(),now,scheduledTime:now,request:api.request});
  assert.equal(result.state,"BLOCKED");
  assert.equal(result.reason,"GITHUB_DISPATCH_CREDENTIAL_NOT_CONFIGURED");
  assert.equal(api.calls.length,0);
  assert.equal(env.R2_ARCHIVE.data.size,0);
});

test("fresh canonical R2 does not raise a false missing-token Cron alarm",async()=>{
  const env={...config(),TENNIS_GITHUB_DISPATCH_TOKEN:"",R2_ARCHIVE:r2()};
  const api=github();
  const result=await recoverStaleTennis(env,{
    health:health(35,120),now,scheduledTime:now,request:api.request,
  });
  assert.equal(result.state,"NOT_DUE");
  assert.equal(result.reason,"FRESH");
  assert.equal(api.calls.length,0);
});

test("bounded current recovery dispatch is main-only, fixed workflow/scope and makes no bets",async()=>{
  const env={...config(),R2_ARCHIVE:r2()};
  const api=github();
  const result=await recoverStaleTennis(env,{health:health(145,200),now,scheduledTime:now,request:api.request});
  assert.equal(result.state,"DISPATCHED");
  assert.equal(result.scope,"current");
  assert.equal(result.bet,false);
  assert.equal(result.canAuthorizeWager,false);
  assert.deepEqual(api.calls.map(c=>c.method),["GET","POST"]);
  const call=api.calls[1];
  assert.equal(call.url,"https://api.github.com/repos/coachhornsby/fbis/actions/workflows/tennis-refresh.yml/dispatches");
  assert.deepEqual(JSON.parse(call.body),{ref:"main",inputs:{scope:"current",recovery_slot:new Date(now).toISOString()}});
  assert.equal(env.R2_ARCHIVE.data.size,2);
  const marker=JSON.parse(env.R2_ARCHIVE.data.get("tennis/ops/recovery/last-dispatch.json"));
  assert.equal(marker.scope,"current");
  assert.equal(marker.source,"CLOUDFLARE_CANONICAL_RECOVERY");
  assert.equal(marker.token,undefined);
  const second=await recoverStaleTennis(env,{health:health(),now:now+30*60000,scheduledTime:now+30*60000,request:api.request});
  assert.equal(second.state,"COOLDOWN");
  assert.equal(api.calls.length,2);
});

test("full refresh recovers independently when its six-hour schedule is missed",async()=>{
  const env={...config(),R2_ARCHIVE:r2()},api=github();
  const result=await recoverStaleTennis(env,{health:health(155,465),now,scheduledTime:now,request:api.request});
  assert.equal(result.scope,"full");
  assert.equal(JSON.parse(api.calls[1].body).inputs.scope,"full");
});

test("active, queued, or recently dispatched GitHub Actions prevent duplicate recovery",async()=>{
  const env={...config(),R2_ARCHIVE:r2()},running={
    id:100,status:"queued",head_branch:"main",event:"schedule",created_at:new Date(now-12000).toISOString(),
  },api=github({runs:[running]});
  const result=await recoverStaleTennis(env,{health:health(),now,scheduledTime:now,request:api.request});
  assert.equal(result.state,"IN_PROGRESS");
  assert.equal(api.calls.length,1);
  assert.equal(env.R2_ARCHIVE.data.size,0);
});

test("failed/ambiguous dispatch cannot be retried or claimed as healthy",async()=>{
  const env={...config(),R2_ARCHIVE:r2()},api=github({postStatus:500});
  await assert.rejects(recoverStaleTennis(env,{health:health(),now,scheduledTime:now,request:api.request}),/DISPATCH_HTTP_500/);
  assert.equal(api.calls.filter(c=>c.method==="POST").length,1);
  assert.equal(env.R2_ARCHIVE.data.size,0);
  const delayed=await recoverStaleTennis(env,{health:health(),now,scheduledTime:now-360000,request:api.request});
  assert.equal(delayed.reason,"STALE_CLOUDFLARE_SCHEDULE_EVENT");
});

test("GitHub runner rechecks R2 and skips its queued refresh if newly healthy",()=>{
  const at=new Date(now-30*60000).toISOString(),start=new Date(now-31*60000).toISOString();
  const h={ok:true,scope:"current",bet:false,refreshStartedAt:start,refreshCompletedAt:at,
    files:1,canonicalMatches:30550,players:1686,identityCollisions:6};
  const m={scope:"current",refreshStartedAt:start,refreshCompletedAt:at,files:[{}]};
  assert.deepEqual(decideTennisRecoveryExecution("current",h,m,now).run,false);
  const staleAt=new Date(now-125*60000).toISOString();
  const staleStart=new Date(now-126*60000).toISOString();
  assert.equal(decideTennisRecoveryExecution("current",
    {...h,refreshStartedAt:staleStart,refreshCompletedAt:staleAt},
    {...m,refreshStartedAt:staleStart,refreshCompletedAt:staleAt},now).run,true);
  assert.equal(decideTennisRecoveryExecution("current",{...h,bet:true},m,now).ok,false);
});

test("cloudflare cron wiring, GitHub constraints and dual cadence are explicit",()=>{
  const root=url=>readFileSync(new URL(url,import.meta.url),"utf8");
  const wf=root("../.github/workflows/tennis-refresh.yml");
  const wrangler=root("../wrangler.orchestrator.toml");
  const worker=root("../workers/sports-projection-orchestrator-worker.mjs");
  const deploy=root("../.github/workflows/deploy-cloudflare-orchestrator.yml");
  assert.equal(TENNIS_RECOVERY_CRON,"27,57 * * * *");
  assert.match(wrangler,/27,57 \* \* \* \*/);
  assert.match(wrangler,/TENNIS_RECOVERY_ENABLED = "true"/);
  assert.match(worker,/runTennisRecoveryCron\(env/);
  assert.match(worker,/credentialConfigured/);
  assert.match(wf,/recovery_slot/);
  assert.match(wf,/tennis-refresh-recovery-gate\.mjs/);
  assert.match(wf,/steps\.recovery_gate\.outputs\.run == 'true'/);
  assert.match(wf,/group: tennis-canonical-refresh/);
  assert.match(deploy,/secrets\.TENNIS_DISPATCH_GITHUB_TOKEN/);
  assert.match(deploy,/secret put TENNIS_GITHUB_DISPATCH_TOKEN/);
  assert.doesNotMatch(worker,/TENNIS_GITHUB_DISPATCH_TOKEN\s*=\s*["'][^"']+["']/);
  assert.ok(typeof runTennisRecoveryCron==="function");
});
