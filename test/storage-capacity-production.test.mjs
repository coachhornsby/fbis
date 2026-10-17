import test from "node:test";
import assert from "node:assert/strict";
import {summarizeD1Storage,onRequestGet,onRequestPost,D1_DATABASE_MAX_BYTES} from "../functions/api/storage-capacity.js";
const request=(secret,url="https://fbis.test/api/storage-capacity")=>new Request(url,{headers:secret?{"x-harvest-secret":secret}:{}});
const binding=bytes=>({prepare(sql){
  if(sql!=="SELECT 1 AS healthy")throw Error("UNEXPECTED_SQL");
  return {async all(){return {results:[{healthy:1}],meta:{size_after:bytes}}}};
}});
const env={HARVEST_SECRET:"test",DB:binding(10_003_816_448),MARKET_HISTORY_DB:binding(143_360),OPERATIONS_DB:binding(20_480)};
test("storage size reports correct 10 GB per-db hard cap and no imaginary account or R2 billing",()=>{
  assert.equal(D1_DATABASE_MAX_BYTES,10_000_000_000);
  const r=summarizeD1Storage(10_003_816_448,143_360,20_480);
  assert.equal(r.state,"PRIMARY_OVER_LIMIT");
  assert.equal(r.primary.remainingBytes,0);
  assert.equal(r.primary.state,"OVER_LIMIT");
  assert.equal(r.primary.alertLevel,"OVER_LIMIT");
  assert.equal(r.historyShard.state,"OK");
  assert.equal(r.operations.state,"OK");
  assert.equal(r.knownBoundD1Bytes,10_003_980_288);
  assert.equal(r.accountWideUsageMeasured,false);
  assert.equal(r.r2BillableBytesMeasured,false);
  assert.equal(r.invoiceEstimated,false);
  assert.equal(r.historicRowsDeletedByProbe,0);
  assert.deepEqual(r.capacityAlertThresholds,[80,85,90]);
  assert.equal(r.operationsDbPreferred,true);
});
test("boundary alerts use 80 watch, 85 high, 90 critical",()=>{
 assert.equal(summarizeD1Storage(7_900_000_000,1).state,"PRIMARY_WITH_HEADROOM");
 assert.equal(summarizeD1Storage(8_000_000_000,1).state,"PRIMARY_WATCH");
 assert.equal(summarizeD1Storage(8_500_000_000,1).primary.state,"HIGH");
 assert.equal(summarizeD1Storage(9_000_000_000,1).state,"PRIMARY_CRITICAL");
 assert.equal(summarizeD1Storage(9_900_000_000,1).primary.state,"EMERGENCY");
 for(const n of [NaN,0,-1,Infinity,1.5])assert.throws(()=>summarizeD1Storage(n,100),/STORAGE_SIZE_UNAVAILABLE/);
});
test("production route private no-store and only read-only D1 probes",async()=>{
 const anonymous=await onRequestGet({env,request:request(null)});
 assert.equal(anonymous.status,403);
 assert.equal((await onRequestGet({env,request:request(null,"https://fbis.test/api/storage-capacity?secret=test")})).status,403);
 const result=await onRequestGet({env,request:request("test")});
 const body=await result.json();
 assert.equal(result.status,200);assert.equal(body.ok,true);
 assert.equal(body.primary.usedBytes,10_003_816_448);
 assert.equal(body.operations.usedBytes,20_480);
 assert.equal(result.headers.get("cache-control"),"private, no-store");
 assert.equal((await onRequestPost()).status,405);
});
test("absent bindings or unavailable D1 size metadata fail closed without guessed capacity",async()=>{
 assert.equal((await onRequestGet({env:{HARVEST_SECRET:"test",DB:env.DB},request:request("test")})).status,503);
 const bad={...env,DB:binding(undefined)};
 const r=await onRequestGet({env:bad,request:request("test")});
 assert.equal(r.status,503);
 assert.equal((await r.json()).error,"STORAGE_METADATA_UNAVAILABLE");
});
