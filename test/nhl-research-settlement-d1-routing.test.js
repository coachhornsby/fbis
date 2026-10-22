import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestGet as goalieGet } from "../functions/api/nhl-goalie-shadow.js";
import { onRequestGet as researchGet } from "../functions/api/nhl-wager-research.js";

const source=readFileSync(new URL("../functions/api/nhl-goalie-shadow.js",import.meta.url),"utf8");
const research=readFileSync(new URL("../functions/api/nhl-wager-research.js",import.meta.url),"utf8");
function fakeDb(label) {
 const calls=[];
 return {calls,prepare(sql){
   calls.push({label,sql});
   return {bind(){return this;},async first(){return {n:2,graded_n:0};},
     async all(){return {results:[]};}};
 }};
}
function env(mode,approved=true){
 const DB=fakeDb("PRIMARY"),NHL_DB=fakeDb("NHL_DB"),receipt="nhl-test";
 return {DB,NHL_DB,SPORT_DB_MODE_NHL:mode,SPORT_DB_STRICT_NHL:"true",
  SPORT_CUTOVER_RECEIPT_NHL:receipt,__fbisCutoverApprovals:new Map(
   approved?[["nhl:"+receipt,{status:"APPROVED",receipt_id:receipt}]]:[])};
}
const ctx=env=>({env,request:new Request("https://example.com/api/nhl-wager-research")});
for(const [label,get] of [["goalie",goalieGet],["wager",researchGet]]) {
 test(label+" reads PRIMARY in shadow",async()=>{
  const e=env("shadow"),response=await get(ctx(e));
  assert.equal(response.status,200);
  assert.ok(e.DB.calls.length>0);assert.equal(e.NHL_DB.calls.length,0);
 });
 test(label+" reads owned NHL research through approved shard",async()=>{
  const e=env("sport"),response=await get(ctx(e));
  assert.equal(response.status,200);
  assert.ok(e.NHL_DB.calls.length>0);assert.equal(e.DB.calls.length,0);
 });
 test(label+" fails closed without matching CORE receipt in strict mode",async()=>{
  const e=env("sport",false),response=await get(ctx(e));
  assert.equal(response.status,503);
  assert.equal(e.DB.calls.length,0);assert.equal(e.NHL_DB.calls.length,0);
 });
}
test("goalie shadow research and canonical economic evidence are independently routed",()=>{
 assert.match(source,/persistCanonicalProspectiveEvidence\(canonicalDb,/);
 assert.match(source,/markCanonicalEvidenceGraded\(canonicalDb,/);
 assert.match(source,/persistCanonicalEconomicGrade\(canonicalDb,/);
 assert.match(source,/settle\(db,resolved\.date,\{canonicalDb:context\.env\.DB\}\)/);
 assert.match(source,/persist\(db,rows,\{canonicalDb:context\.env\.DB\}\)/);
});
test("wager research never confers staking authority and keeps old calibration view optional",()=>{
 assert.match(research,/canAuthorizeWager:false/);
 assert.match(research,/nhl_wager_confidence_calibration[^\n]+\.catch\(\(\)=>\(\{results:\[\]\}\)\)/);
 assert.match(research,/\.\.\.context\.env/);
});
