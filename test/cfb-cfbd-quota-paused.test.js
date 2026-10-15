import {test} from "node:test";
import assert from "node:assert/strict";
import {onRequestGet} from "../functions/api/college.js";

function exhaustedDb(now) {
  const month=new Date(now).toISOString().slice(0,7);
  const date=new Date(now).toISOString();
  return {prepare(sql) {
    return {bind() {return {async first() {
      if(sql.includes("last_429_at"))return {last_remaining:0,last_429_at:date,blocked_until_ms:now+3600000};
      if(sql.includes("request_day=?"))return {attempts:1};
      if(sql.includes("request_month=?"))return {attempts:1,succeeded:0,rate_limited:1};
      return {};
    }};}};
  }};
}
for (const job of ["cfb-postgame-harvest","cfb-current-refresh","cbb-current-refresh","cbb-postgame-harvest"]) {
  test(`${job}: quota zero pauses with no external HTTP`, async()=>{
    const previous=globalThis.caches;
    globalThis.caches={default:{}};
    const now=Date.now(),db=exhaustedDb(now);
    const req=new Request(`https://fbis.test/api/college?job=${job}&trigger=schedule`,{
      headers:{"x-harvest-secret":"test-only-secret"}
    });
    try{
      const response=await onRequestGet({request:req,env:{
        HARVEST_SECRET:"test-only-secret",DB:db,CFBD_API_KEY:"fake-key"
      }});
      const body=await response.json();
      assert.equal(response.status,200);
      assert.equal(body.status,"paused");
      assert.equal(body.reason,"COLLEGE_SHARED_MONTHLY_QUOTA_EXHAUSTED");
      assert.equal(body.networkCalls,0);
      assert.equal(body.d1.cfbdAcquisition.providerRemaining,0);
    }finally{globalThis.caches=previous;}
  });
}
