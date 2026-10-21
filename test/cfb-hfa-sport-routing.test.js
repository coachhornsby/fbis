import test from "node:test";
import assert from "node:assert/strict";
import { persistHfaRating, persistHfaExternal, loadHfaRatings } from "../functions/lib/store.js";

function db() {
 const calls=[];
 return {calls,prepare(sql) {
  return {bind(...args){this.args=args;return this;},
   async run(){calls.push(sql);return {meta:{changes:1}};},
   async all(){calls.push(sql);return {results:[]};}};
 }};
}
function env() {
 const DB=db(),CFB_DB=db(),receipt="fixture";
 return {DB,CFB_DB,SPORT_DB_MODE_CFB:"sport",SPORT_DB_STRICT_CFB:"true",
 SPORT_CUTOVER_RECEIPT_CFB:receipt,
 __fbisCutoverApprovals:new Map([["cfb:"+receipt,{status:"APPROVED",receipt_id:receipt}]])};
}
test("CFB home-field ratings only update the approved sport shard", async()=>{
 const e=env();
 const ret=await persistHfaRating(e,{teamKey:"team",method:"test",asOfSeason:2026});
 assert.equal(ret.ok,true);
 assert.equal(e.DB.calls.length,0);
 assert.equal(e.CFB_DB.calls.length,1);
 const ratings=await loadHfaRatings(e,"test",2026);
 assert.deepEqual(ratings,{});
 assert.equal(e.CFB_DB.calls.length,2);
});
test("CFB external HFA benchmarks remain PRIMARY-owned",async()=>{
 const e=env();
 const ret=await persistHfaExternal(e,{teamKey:"team",source:"external",ratingYear:2026});
 assert.equal(ret.ok,true);
 assert.equal(e.DB.calls.length,1);
 assert.equal(e.CFB_DB.calls.length,0);
});
test("strict-mode approval failure rejects CFB HFA writers",async()=>{
 const e=env();e.__fbisCutoverApprovals.clear();
 const ret=await persistHfaRating(e,{teamKey:"team",method:"test"});
 assert.equal(ret.ok,false);
 assert.equal(e.DB.calls.length,0);
});
