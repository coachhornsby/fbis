import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/_middleware.js";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";

const DB={prepare(){return {async first(){return {ok:1}}};}};
const NFL_DB={prepare(){return {async first(){return {ok:1}}};}};
function core(rows){
  return {prepare(sql){
    return {
      bind(){return this;},
      async all(){
        if(sql.includes("expires_at")) throw new Error("legacy CORE schema");
        return {results:rows};
      },
    };
  }};
}
async function requestWith(rows) {
  const env={
    DB,NFL_DB,CORE_DB:core(rows),
    SPORT_DB_MODE_NFL:"sport",
    SPORT_CUTOVER_RECEIPT_NFL:"fixture-approved",
  };
  return await onRequest({
    env,request:new Request("https://example.com/api/projections?sport=nfl"),
    next:async()=>productSportDbHandle(env,"nfl"),
  });
}
test("Pages API middleware hydrates approved CORE receipt before NFL product reads",async()=>{
  const result=await requestWith([{receipt_id:"fixture-approved",sport:"nfl",status:"APPROVED",approved_at:"2026-10-21T12:00:00Z"}]);
  assert.equal(result.binding,"NFL_DB");
  assert.equal(result.canAuthorizeWager,false);
});
test("Pages API middleware refuses missing or revoked CORE grant",async()=>{
  const result=await requestWith([]);
  assert.equal(result.binding,"DB");
  assert.equal(result.canAuthorizeWager,false);
});
