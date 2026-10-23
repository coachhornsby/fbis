import test from "node:test";
import assert from "node:assert/strict";
import { collectAuthoritySportBoardStats } from "../functions/lib/coreBoardSummaries.js";

function db(count) {
 return {prepare(){return {bind(){return this;},async first(){return {n:count,freshest:"2026-10-21T12:00:00Z"};}};}};
}
const DB=db(12), NFL_DB=db(99);
test("CORE aggregate reads PRIMARY during shadow",async()=>{
 const r=await collectAuthoritySportBoardStats({DB,NFL_DB,SPORT_DB_MODE_NFL:"shadow"},"nfl");
 assert.equal(r.authority,"PRIMARY");assert.equal(r.gameCount,12);
});
test("CORE aggregate refuses stale PRIMARY while NFL configured as sport but not approved",async()=>{
 const r=await collectAuthoritySportBoardStats({DB,NFL_DB,SPORT_DB_MODE_NFL:"sport"},"nfl");
 assert.equal(r.complete,false);assert.match(r.reason,/CUTOVER_APPROVAL|SPORT_AUTHORITY/);
});
test("CORE aggregate reads sport D1 only with a hydrated matching approval",async()=>{
 const receipt="test-approved";
 const env={DB,NFL_DB,SPORT_DB_MODE_NFL:"sport",SPORT_CUTOVER_RECEIPT_NFL:receipt,
   CORE_DB:{prepare(){return {bind(){return this},async all(){return {results:[{status:"APPROVED",sport:"nfl",receipt_id:receipt,approved_at:"2026-10-21T12:00:00Z"}]}}}}}};
 const r=await collectAuthoritySportBoardStats(env,"nfl");
 assert.equal(r.complete,true);assert.equal(r.authority,"SPORT_DB");assert.equal(r.gameCount,99);
});

test("CORE aggregate denies a revoked NBA receipt on a fresh request",async()=>{
 const nba=db(77),receipt="nba-no-longer-approved";
 const env={DB,NBA_DB:nba,SPORT_DB_MODE_NBA:"sport",SPORT_CUTOVER_RECEIPT_NBA:receipt,
   CORE_DB:{prepare(){return {bind(){return this},async all(){return {results:[]}}}}}};
 const r=await collectAuthoritySportBoardStats(env,"nba");
 assert.equal(r.complete,false);
 assert.equal(r.reason,"SPORT_AUTHORITY_UNVERIFIED");
});
