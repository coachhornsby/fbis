import {test} from "node:test";
import assert from "node:assert/strict";
import {reserveCfbdRequest,completeCfbdRequest,cfbdRequestHash} from "../functions/lib/cfbCfbdAcquisition.js";
import {fetchWithCfbBackoff} from "../functions/lib/cfbProviderBackoff.js";
import {resetCacheMem} from "../functions/lib/cache.js";
const URL="https://api.collegefootballdata.com/ppa/teams?year=2026";
function mockDb() {
  const seen=new Set(), receipts=[], control=[];
  return {
    receipts,control,
    prepare(sql) {
      return {bind(...params) {return {async run() {
        if(sql.includes("INSERT OR IGNORE INTO cfb_cfbd_acquisition_receipts")){
          const unique=params[0]+"|"+params[1];
          if(seen.has(unique))return {meta:{changes:0}};
          seen.add(unique);receipts.push(params);return {meta:{changes:1}};
        }
        control.push({sql,params});return {meta:{changes:1}};
      }}};}
    }
  };
}
test("owner authorization is required for D1-bound production CFBD HTTP",async()=>{
  resetCacheMem();
  const db=mockDb();let network=0;
  const transport=async()=>{network++;return Response.json([])};
  const res=await fetchWithCfbBackoff(URL,{}, {DB:db},transport);
  assert.equal(res.status,503);
  assert.equal(network,0);
  assert.equal(db.receipts.length,0);
});
test("no D1 means production authorization fails closed",async()=>{
  const permit=await reserveCfbdRequest({cfbdNetworkAuthorized:true},URL);
  assert.equal(permit.allowed,false);
  assert.equal(permit.reason,"CFBD_D1_REQUIRED");
});
test("one atomic D1 receipt per endpoint/query per Chicago partition",async()=>{
  const db=mockDb(); const env={DB:db,cfbdNetworkAuthorized:true};
  const a=await reserveCfbdRequest(env,URL,Date.parse("2026-10-15T12:30:00Z"));
  const b=await reserveCfbdRequest(env,URL,Date.parse("2026-10-15T12:32:00Z"));
  assert.equal(a.allowed,true);
  assert.equal(b.allowed,false);
  assert.equal(db.receipts.length,1);
  const hash1=await cfbdRequestHash("https://api.collegefootballdata.com/ppa/teams?year=2026&seasonType=regular");
  const hash2=await cfbdRequestHash("https://api.collegefootballdata.com/ppa/teams?seasonType=regular&year=2026");
  assert.equal(hash1.hash,hash2.hash);
});
test("429 receipt records durable cooldown and preserves reserved attempt",async()=>{
  const db=mockDb();const env={DB:db,cfbdNetworkAuthorized:true};
  const permit=await reserveCfbdRequest(env,URL);
  await completeCfbdRequest(env,permit,429,new Response("limited",{status:429,headers:{"Retry-After":"120","X-CallLimit-Remaining":"5"}}));
  assert.ok(db.control.some(x=>x.sql.includes("last_429_at")));
  assert.ok(db.control.some(x=>x.sql.includes("request_status")));
  assert.equal(db.receipts.length,1);
});
test("different production Worker instances cannot replay same permit",async()=>{
  const db=mockDb();const env={DB:db,cfbdNetworkAuthorized:true};
  // Separate logical calls to the durable reservation store.
  const first=await reserveCfbdRequest(env,URL);
  const second=await reserveCfbdRequest({...env},URL);
  assert.equal(first.allowed,true);assert.equal(second.allowed,false);
});
