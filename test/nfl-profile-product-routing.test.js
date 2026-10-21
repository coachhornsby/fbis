import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/nfl-team-profiles.js";

function fakeDb(teams) {
  return {prepare(sql) {
    return {
      bind(){return this;},
      async first(){return {n:teams,latest:"2026-10-21T00:00:00Z",head_coaches:teams};},
      async all(){return {results:[]};}
    };
  }};
}
function ctx(env) {
  return {env,request:new Request("https://test.example/api/nfl-team-profiles?summary=1")};
}
test("NFL profile endpoint stays PRIMARY while deployed shadow",async()=>{
  const env={DB:fakeDb(32),NFL_DB:fakeDb(999),SPORT_DB_MODE_NFL:"shadow"};
  const res=await onRequestGet(ctx(env)),body=await res.json();
  assert.equal(body.teams,32);
});
test("Unapproved NFL sport mode must not switch profile readers",async()=>{
  const env={DB:fakeDb(32),NFL_DB:fakeDb(999),SPORT_DB_MODE_NFL:"sport",SPORT_CUTOVER_RECEIPT_NFL:"not-approved"};
  const res=await onRequestGet(ctx(env)),body=await res.json();
  assert.equal(body.teams,32);
});
