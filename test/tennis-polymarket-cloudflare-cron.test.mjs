import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runTennisPolymarketResearchCron} from "../workers/tennis-polymarket-research-cron.mjs";
const now=Date.parse("2026-10-20T19:00:00Z");
const env=(snapshot)=>({HARVEST_SECRET:"test-secret",R2_ARCHIVE:{get:async()=>snapshot===null?null:{json:async()=>snapshot}}});
test("fresh R2 Polymarket archive bypasses unnecessary repeated harvests",async()=>{
 let requested=0;
 const ret=await runTennisPolymarketResearchCron(env({source:"POLYMARKET_GLOBAL_GAMMA",asOf:"2026-10-20T18:55:00Z",events:[]}),{now,request:async()=>{requested++;throw Error("not expected")}});
 assert.equal(ret.status,"SKIPPED_FRESH");
 assert.equal(requested,0);
 assert.equal(ret.canAuthorizeWager,false);
});
test("stale snapshot uses fixed-domain authenticated POST and checks research-only receipt",async()=>{
 const calls=[];
 const out=await runTennisPolymarketResearchCron(env({source:"POLYMARKET_GLOBAL_GAMMA",asOf:"2026-10-20T17:26:00Z",events:[]}),{
  now,request:async(url,options)=>{
   calls.push({url,options});
   return {ok:true,status:200,json:async()=>({ok:true,source:"POLYMARKET_GLOBAL_GAMMA",asOf:"2026-10-20T19:00:00Z",fixtureCount:24,matchedEvents:12,errors:[{code:"SEARCH_SCHEMA_INVALID"}],canAuthorizeWager:false})};
  }
 });
 assert.equal(out.status,"REFRESHED");
 assert.equal(out.matchedEvents,12);
 assert.equal(out.warnings,1);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,"https://fbis-myz.pages.dev/api/polymarket-global-tennis-collect");
 assert.equal(calls[0].options.method,"POST");
 assert.equal(calls[0].options.headers["x-harvest-secret"],"test-secret");
 assert.equal(out.canAuthorizeWager,false);
});
test("missing credentials and forged wagering-capable receipt fail closed",async()=>{
 await assert.rejects(runTennisPolymarketResearchCron({R2_ARCHIVE:env(null).R2_ARCHIVE},{now,request:async()=>({ok:true})}),/SECRET_OR_ARCHIVE_MISSING/);
 await assert.rejects(runTennisPolymarketResearchCron(env(null),{
  now,request:async()=>({ok:true,json:async()=>({ok:true,source:"POLYMARKET_GLOBAL_GAMMA",asOf:"2026-10-20T19:00:00Z",canAuthorizeWager:true})})
 }),/RECEIPT_INVALID/);
});
test("Polymarket refresh runs from actual RECOVERY_CRON branch, not a shadowed duplicate cron",()=>{
 const src=readFileSync(new URL("../workers/sports-projection-orchestrator-worker.mjs",import.meta.url),"utf8");
 const recovery=readFileSync(new URL("../workers/prospective-pipeline-recovery.mjs",import.meta.url),"utf8");
 assert.ok(recovery.includes('RECOVERY_CRON = "*/10 * * * *"'));
 assert.ok(src.includes("cron === RECOVERY_CRON"));
 assert.ok(src.includes("runRecoveryWithTennisResearch(env, controller)"));
 assert.ok(src.includes("recoverCurrentPipeline(env,controller),runTennisPolymarketResearchCron(env)"));
 assert.ok(!src.includes('cron === "*/10 * * * *"'));
 assert.ok(src.includes("cron === TENNIS_RECOVERY_CRON"));
});
