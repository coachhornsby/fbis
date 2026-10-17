import test from "node:test";
import assert from "node:assert/strict";
import {onRequestGet,onRequestPost} from "../functions/api/operations-db-health.js";
const auth = new Headers({"x-harvest-secret":"test"});
test("operations health refuses unauthenticated requests",async()=>{
  const r=await onRequestGet({env:{HARVEST_SECRET:"test"},request:{headers:new Headers()}});
  assert.equal(r.status,403);
});
test("operations health refuses absent binding",async()=>{
  const r=await onRequestGet({env:{HARVEST_SECRET:"test"},request:{headers:auth}});
  assert.equal(r.status,503);
});
test("operations health reports ready without primary DB",async()=>{
  const env={HARVEST_SECRET:"test",OPERATIONS_DB:{prepare:()=>{
    return {first:async()=>({schema_ready:1,jobs_ready:1})};
  }}};
  const r=await onRequestGet({env,request:{headers:auth}});
  assert.equal(r.status,200);
  assert.equal((await r.json()).operationsDb,"ready");
});
test("operations health fails closed when job schema is absent",async()=>{
  const env={HARVEST_SECRET:"test",OPERATIONS_DB:{prepare:()=>({first:async()=>({schema_ready:1,jobs_ready:0})})}};
  const r=await onRequestGet({env,request:{headers:auth}});
  assert.equal(r.status,503);
});
test("operations health does not allow writes",async()=>{
  const r=await onRequestPost();
  assert.equal(r.status,405);
});
