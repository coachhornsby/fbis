import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {collegeRequest} from "../functions/lib/collegeApi.js";
import {probeCfbdEndpoint} from "../functions/lib/cfbdEndpointAudit.js";
import {loadCfbDeepFeatures} from "../functions/lib/cfbDeepFeed.js";

test("background CFBD college client fails closed on cache miss without any provider call",async()=>{
 let calls=0;
 const env={CFBD_API_KEY:"dummy-test",cfbdCacheOnly:true};
 const r=await collegeRequest("cfbd","/ratings/sp",env,{
  query:{year:2026},fetchFn:async()=>{calls++;throw Error("never call provider")}
 });
 assert.equal(r.reason,"CFBD_MORNING_ONLY_CACHE_MISS");
 assert.equal(r.networkAttempted,false);
 assert.equal(r.quotaCost,0);
 assert.equal(calls,0);
});

test("direct CFBD endpoint-audit probes cannot bypass the morning network policy",async()=>{
 let calls=0;
 const r=await probeCfbdEndpoint("/ratings/fpi",
   {CFBD_API_KEY:"dummy-test",cfbdCacheOnly:true},
   {query:{year:2026},fetchFn:async()=>{calls++;throw Error("network forbidden")}});
 assert.equal(r.error,"CFBD_MORNING_ONLY_AUDIT_DISABLED");
 assert.equal(r.networkAttempted,false);
 assert.equal(calls,0);
});

test("CFB deep form does not call CFBD when cache is cold in daytime",async()=>{
 let calls=0;
 const r=await loadCfbDeepFeatures({CFBD_API_KEY:"dummy-test",cfbdCacheOnly:true},{
  now:Date.parse("2026-10-15T14:00:00Z"),
  fetchFn:async()=>{calls++;throw Error("network forbidden")}});
 assert.equal(r.meta.cacheOnly,true);
 assert.equal(calls,0);
});

test("production college route authorizes only morning postgame CFBD acquisition",()=>{
 const source=readFileSync(new URL("../functions/api/college.js",import.meta.url),"utf8");
 assert.match(source,/cfbdCacheOnly\s*=\s*job\s*!==\s*"cfb-postgame-harvest"/);
 const schedule=readFileSync(new URL("../.github/workflows/college.yml",import.meta.url),"utf8");
 assert.match(schedule,/cron:\s*"30 12 \* \* \*"/);
 const section=schedule.slice(schedule.indexOf('elif [ "$EVENT_NAME" = "schedule" ]'),schedule.indexOf('else\n            call "$JOB"'));
 assert.equal((section.match(/call cfb-postgame-harvest/g)||[]).length,1);
 assert.doesNotMatch(section,/call cfb-current-refresh|call cfb-pregame-freeze/);
 assert.match(schedule,/CFBD_RATE_LIMITED=1/);
 assert.match(schedule,/CFBD 429: morning CFB ingestion FAILED/);
});
