import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {isPreImportLock,runD1ImportWithRetry} from "../scripts/d1-import-lock-retry.mjs";
import {
  checkNbaProfileReconciliation,parseD1Counts,parseWranglerD1Counts,readNbaPersistence,
} from "../scripts/nba-profile-persistence-verify.mjs";
import {
  TENNIS_HEALTH_CRON,evaluateTennisRefreshScope,checkTennisRefreshHealth,
} from "../workers/tennis-refresh-health.mjs";

const lock="Currently processing a long-running import. Cannot start another import until that completes or times out.";
const fakeProfile={asOf:"2026-10-11T01:04:12.000Z",quality:{teams:30,players:455,scheduleItems:2000}};
const complete={teams:30,snapshots:30,players:454,schedule_items:2000};
const now=Date.parse("2026-10-11T02:37:00Z");
function r2Scope(scope,{at="2026-10-11T02:03:00.000Z",bet=false,manifestMismatch=false}={}) {
  const started="2026-10-11T02:02:00.000Z";
  return {
    health:{ok:true,scope,bet,refreshStartedAt:started,refreshCompletedAt:at,
      files:14,canonicalMatches:scope==="full"?99211:30550,players:scope==="full"?4246:1686,
      identityCollisions:6,workflowRunId:"123"},
    manifest:{scope,refreshStartedAt:started,refreshCompletedAt:manifestMismatch?"2026-10-11T02:03:10Z":at,files:Array(14).fill({kind:"ATP_TOUR"})},
  };
}
function bucket(a,b) {
  const objects={
    "tennis/canonical/current/latest/refresh-health.json":JSON.stringify(a.health),
    "tennis/canonical/current/latest/source-manifest.json":JSON.stringify(a.manifest),
    "tennis/canonical/full/latest/refresh-health.json":JSON.stringify(b.health),
    "tennis/canonical/full/latest/source-manifest.json":JSON.stringify(b.manifest),
  };
  return {get:async key=>objects[key]?{json:async()=>JSON.parse(objects[key])}:null};
}

test("only D1's explicit pre-import lock can be retried",()=>{
  assert.equal(isPreImportLock(lock),true);
  assert.equal(isPreImportLock("Error 7500 internal error"),false);
  assert.equal(isPreImportLock("SQLITE_CONSTRAINT UNIQUE failure"),false);
  assert.equal(isPreImportLock("D1 import timed out after writing 100 rows"),false);
});

test("bounded D1 import retries one confirmed pre-import rejection, then succeeds",async()=>{
  let calls=0;const sleeps=[],events=[];
  const result=await runD1ImportWithRetry({
    file:"artifacts/partial.sql",
    execute:async()=>++calls===1?{code:1,output:lock}:{code:0,output:"complete"},
    sleep:async delay=>sleeps.push(delay),delays:[10,20,30],log:e=>events.push(e),
  });
  assert.equal(result.ok,true);
  assert.equal(result.attempts,2);
  assert.equal(calls,2);
  assert.deepEqual(sleeps,[10]);
  assert.equal(events[0].type,"PRE_IMPORT_LOCK_RETRY");
});

test("generic errors never replay imports that may have been partially written",async()=>{
  let count=0;
  await assert.rejects(runD1ImportWithRetry({
    file:"artifacts/partial.sql",
    execute:async()=>{count++;return {code:1,output:"D1 7500 / maybe partially committed"};},
    delays:[0,0],sleep:async()=>{},
  }),/NON_REPLAYABLE/);
  assert.equal(count,1);
});

test("repeated pre-import lock stops at bounded budget without publishing",async()=>{
  let count=0;
  await assert.rejects(runD1ImportWithRetry({
    file:"artifacts/partial.sql",
    execute:async()=>{count++;return {code:1,output:lock};},
    delays:[0,0,0],sleep:async()=>{},
  }),/LOCK_EXHAUSTED/);
  assert.equal(count,4);
});

test("NBA R2 promotion requires matching all-30 immutable snapshot and player/schedule asOf rows",()=>{
  assert.equal(checkNbaProfileReconciliation(fakeProfile,complete).ok,true);
  for(const diff of [{teams:29},{snapshots:29},{players:290},{schedule_items:800}]){
    const evidence=checkNbaProfileReconciliation(fakeProfile,{...complete,...diff});
    assert.equal(evidence.ok,false,JSON.stringify(diff));
  }
  assert.equal(checkNbaProfileReconciliation({...fakeProfile,quality:{...fakeProfile.quality,teams:29}},complete).ok,false);
});

test("NBA reconciliation uses only read-only D1 query with exact asOf parameters",async()=>{
  let body=null;
  const observed=await readNbaPersistence(fakeProfile,{
    env:{CLOUDFLARE_API_TOKEN:"test-only",CLOUDFLARE_ACCOUNT_ID:"account",CLOUDFLARE_D1_DATABASE_ID:"db"},
    fetchImpl:async(_url,opts)=>{
      body=JSON.parse(opts.body);
      return {ok:true,json:async()=>({success:true,result:[{success:true,results:[complete]}]})};
    },
  });
  assert.deepEqual(observed,complete);
  assert.equal(body.params.length,4);
  assert.ok(body.params.every(x=>x===fakeProfile.asOf));
  assert.match(body.sql,/^SELECT/);
  assert.doesNotMatch(body.sql,/\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP)\b/i);
  assert.throws(()=>parseD1Counts({success:false}),/FAILED/);
});

test("Tennis fresh current/full metadata from R2 is HEALTHY and never betting authority",async()=>{
  const env={R2_ARCHIVE:bucket(r2Scope("current"),r2Scope("full"))};
  const status=await checkTennisRefreshHealth(env,{now});
  assert.equal(status.ok,true);
  assert.equal(status.status,"HEALTHY");
  assert.deepEqual(status.scopes.map(x=>x.scope),["current","full"]);
  assert.ok(status.scopes.every(x=>x.bet===false && x.workflowRunId==="123"));
});

test("Tennis watchdog reports missing, stale, mismatched and unsafe R2 refreshes",async()=>{
  assert.equal(evaluateTennisRefreshScope("current",null,null,now).state,"MISSING");
  const old=r2Scope("current",{at:"2026-10-10T23:00:00Z"});
  old.health.refreshStartedAt="2026-10-10T22:59:00Z";
  old.manifest.refreshStartedAt=old.health.refreshStartedAt;
  assert.equal(evaluateTennisRefreshScope("current",old.health,old.manifest,now).state,"STALE");
  const mismatch=r2Scope("full",{manifestMismatch:true});
  assert.equal(evaluateTennisRefreshScope("full",mismatch.health,mismatch.manifest,now).state,"INVALID");
  const unsafe=r2Scope("current",{bet:true});
  assert.equal(evaluateTennisRefreshScope("current",unsafe.health,unsafe.manifest,now).state,"INVALID");
  const missing=await checkTennisRefreshHealth({}, {now});
  assert.equal(missing.status,"BLOCKED");
  assert.equal(missing.ok,false);
});

test("NBA jobs share a production D1 writer lock; Tennis uses independent existing Worker cron",()=>{
  const profile=readFileSync(new URL("../.github/workflows/nba-team-profiles.yml",import.meta.url),"utf8");
  const shadow=readFileSync(new URL("../.github/workflows/nba-prospective-shadow.yml",import.meta.url),"utf8");
  const worker=readFileSync(new URL("../workers/sports-projection-orchestrator-worker.mjs",import.meta.url),"utf8");
  const wrangler=readFileSync(new URL("../wrangler.orchestrator.toml",import.meta.url),"utf8");
  const shared="nba-d1-profile-shadow-main";
  for(const w of [profile,shadow]){
    assert.ok(w.includes(shared));
    assert.match(w,/cancel-in-progress:\s*false/);
    assert.match(w,/scripts\/d1-import-lock-retry\.mjs/);
    assert.doesNotMatch(w,/npx wrangler d1 execute fbis --remote --file=/);
  }
  assert.match(profile,/nba-profile-persistence-verify\.mjs/);
  assert.ok(profile.indexOf("nba-profile-persistence-verify.mjs")<profile.indexOf("models/nba/team-profiles/snapshots/"));
  assert.equal(TENNIS_HEALTH_CRON,"37 * * * *");
  assert.match(worker,/runTennisHealthCron\(env\)/);
  assert.match(worker,/\/health\/tennis-canonical/);
  assert.match(wrangler,/37 \* \* \* \*/);
  assert.match(wrangler,/binding = "R2_ARCHIVE"/);
  assert.doesNotMatch(worker,/github\.com\/repos\/coachhornsby\/fbis\/actions\/workflows.*tennis/i);
});

test("transient D1 7500 uses a second read-only Wrangler verification without rerunning writes",async()=>{
  let calls=0,sql=null;
  const row=await readNbaPersistence(fakeProfile,{
    env:{CLOUDFLARE_API_TOKEN:"test-only",CLOUDFLARE_ACCOUNT_ID:"account"},
    fetchImpl:async()=>({ok:true,json:async()=>({
      success:false,errors:[{code:7500,message:"internal error"}],
    })}),
    wranglerRead:async cmd=>{calls++;sql=cmd;return complete;},
  });
  assert.deepEqual(row,complete);
  assert.equal(calls,1);
  assert.match(sql,/^SELECT/);
  assert.match(sql,/2026-10-11T01:04:12.000Z/);
  assert.doesNotMatch(sql,/\\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP)\\b/i);
  assert.deepEqual(parseWranglerD1Counts([{success:true,results:[complete]}]),complete);
  await assert.rejects(readNbaPersistence(fakeProfile,{
    env:{CLOUDFLARE_API_TOKEN:"test-only",CLOUDFLARE_ACCOUNT_ID:"account"},
    fetchImpl:async()=>({ok:false,status:401}),
    wranglerRead:async()=>{throw Error("AUTHENTICATION_ERROR_SHOULD_NOT_RETRY");},
  }),/HTTP_401/);
});
