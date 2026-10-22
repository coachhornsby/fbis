import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestGet as getProfiles } from "../functions/api/nhl-team-profiles.js";

function fakeDb(count){
 const calls=[];
 return {calls,prepare(sql){
  return {bind(){return this;},async first(){calls.push(sql);return {n:count,failed:0,latest:"2026-10-21T22:00:00Z"};},async all(){return {results:[]};}};
 }};
}
function context(env){return {env,request:new Request("https://example.com/api/nhl-team-profiles?summary=1")};}
test("NHL profile GET remains PRIMARY in shadow",async()=>{
 const DB=fakeDb(32),NHL_DB=fakeDb(99);
 const r=await getProfiles(context({DB,NHL_DB,SPORT_DB_MODE_NHL:"shadow",NHL_SPORT_DB_MODE:"shadow"}));
 const b=await r.json();assert.equal(b.teams,32);
 assert.ok(DB.calls.length>0);assert.equal(NHL_DB.calls.length,0);
});
test("Approved NHL sport reads D1 independently of PRIMARY",async()=>{
 const DB=fakeDb(32),NHL_DB=fakeDb(99),receipt="fixture";
 const env={DB,NHL_DB,SPORT_DB_MODE_NHL:"sport",NHL_SPORT_DB_MODE:"shadow",
 SPORT_CUTOVER_RECEIPT_NHL:receipt,SPORT_DB_STRICT_NHL:"true",
 __fbisCutoverApprovals:new Map([["nhl:"+receipt,{status:"APPROVED",receipt_id:receipt}]])};
 const r=await getProfiles(context(env)),b=await r.json();
 assert.equal(b.teams,99);assert.ok(NHL_DB.calls.length>0);assert.equal(DB.calls.length,0);
});
test("Strict NHL cutover rejects missing CORE approval, no PRIMARY fallthrough",async()=>{
 const env={DB:fakeDb(32),NHL_DB:fakeDb(99),SPORT_DB_MODE_NHL:"sport",
 SPORT_DB_STRICT_NHL:"true",SPORT_CUTOVER_RECEIPT_NHL:"unapproved",__fbisCutoverApprovals:new Map()};
 const r=await getProfiles(context(env));assert.equal(r.status,503);
 assert.equal(env.DB.calls.length,0);assert.equal(env.NHL_DB.calls.length,0);
});
test("NHL refresh uses sport-owned DB and PRIMARY availability evidence only",()=>{
 const endpoint=readFileSync(new URL("../functions/api/nhl-team-profile-sync.js",import.meta.url),"utf8");
 const store=readFileSync(new URL("../functions/lib/nhlPersistentProfiles.js",import.meta.url),"utf8");
 assert.match(endpoint,/productSportDbHandle\(context\.env,"nhl"\)\.db/);
 assert.match(endpoint,/syncNhlTeamProfile\(\{DB:db,PRIMARY_DB:context\.env\.DB\},team\)/);
 assert.match(store,/availabilityRows\(env\?\.PRIMARY_DB\|\|DB,tkey\)/);
});
