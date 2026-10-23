import test from "node:test";
import assert from "node:assert/strict";
import { insertPublishedProjection, listPublishedProjections } from "../functions/lib/publishedProjectionStore.js";
import { listGlobalNbaFixtureSlugs, capturePolymarketGlobalNba } from "../functions/lib/polymarketGlobalNbaProps.js";
function db(label) {
  const queries=[];
  return {queries,prepare(sql) {
    queries.push(String(sql));
    return {bind(){return this},first:async()=>null,all:async()=>({results:[]}),run:async()=>({meta:{last_row_id:1}})};
  }};
}
const approval={sport:"nba",receipt_id:"nba-phase18-fixture",status:"APPROVED",approved_at:"2026-10-23T12:00:00Z",expires_at:null,revoked_at:null};
const core={prepare(sql) {assert.match(sql,/fbis_sport_cutover_approvals/);return {bind(){return this},all:async()=>({results:[approval]})}}};
const testEnv=(overrides={})=>({DB:db("primary"),NBA_DB:db("nba"),CORE_DB:core,
  SPORT_DB_MODE_NBA:"sport",SPORT_DB_STRICT_NBA:"1",SPORT_DB_LEDGER_READY_NBA:"1",
  SPORT_CUTOVER_RECEIPT_NBA:approval.receipt_id,...overrides});
const row={sport:"nba",gameId:"g1",gameDate:"2026-10-23",modelVersion:"research",payloadHash:"h",payloadJson:"{}",publishedAt:"2026-10-23T12:00:00Z"};
test("approved published NBA writes and scoped reads never access PRIMARY",async()=>{
 const env=testEnv();
 const result=await insertPublishedProjection(env,row);
 assert.equal(result.ok,true);
 assert.ok(env.NBA_DB.queries.some(q=>q.includes("INSERT INTO published_projections")));
 assert.deepEqual(env.DB.queries,[]);
 await listPublishedProjections(env,{sport:"nba"});
 assert.deepEqual(env.DB.queries,[]);
});
test("unapproved NBA published writes fail closed without PRIMARY fallback",async()=>{
 const env=testEnv({CORE_DB:{prepare(){return {bind(){return this},all:async()=>({results:[]})}}}});
 await assert.rejects(()=>insertPublishedProjection(env,row),/NBA_PUBLISHED_OWNER_UNAVAILABLE/);
 assert.deepEqual(env.DB.queries,[]);
 assert.deepEqual(env.NBA_DB.queries,[]);
});
test("shadow published NBA data remains on PRIMARY",async()=>{
 const env=testEnv({SPORT_DB_MODE_NBA:"shadow"});
 await insertPublishedProjection(env,row);
 assert.ok(env.DB.queries.some(q=>q.includes("INSERT INTO published_projections")));
 assert.deepEqual(env.NBA_DB.queries,[]);
});
test("Polymarket fixture research obeys approved NBA_DB and rejects revocation",async()=>{
 const env=testEnv();
 const result=await listGlobalNbaFixtureSlugs(env,{now:new Date("2026-10-23T12:00:00Z")});
 assert.equal(result.ok,true);
 assert.ok(env.NBA_DB.queries.some(q=>q.includes("FROM games")));
 assert.deepEqual(env.DB.queries,[]);
 const denied=testEnv({CORE_DB:{prepare(){return {bind(){return this},all:async()=>({results:[]})}}}});
 const response=await capturePolymarketGlobalNba({...denied,ARCHIVE:{put:async()=>{throw Error("NO_WRITE")}}},{now:new Date("2026-10-23T12:00:00Z"),providedEvents:[]});
 assert.equal(response.ok,false);
 assert.deepEqual(denied.DB.queries,[]);
 assert.deepEqual(denied.NBA_DB.queries,[]);
});

test("approved NBA prop fixture owner never reads PRIMARY and denied authority fails closed",async()=>{
 const { loadPropFixturesAndPlayers } = await import("../functions/lib/propResearchData.js");
 const env=testEnv();
 const opts={sport:"nba",start:"2026-10-23T00:00:00Z",end:"2026-10-24T00:00:00Z"};
 const result=await loadPropFixturesAndPlayers(env,opts);
 assert.deepEqual(result.diagnostics,[]);
 assert.ok(env.NBA_DB.queries.some(q=>q.includes("FROM games")));
 assert.deepEqual(env.DB.queries,[]);
 const revoked=testEnv({CORE_DB:{prepare(){return {bind(){return this},all:async()=>({results:[]})}}}});
 const refused=await loadPropFixturesAndPlayers(revoked,opts);
 assert.deepEqual(refused.games,[]);
 assert.match(refused.diagnostics[0],/NBA_OWNER_UNAVAILABLE/);
 assert.deepEqual(revoked.DB.queries,[]);
 assert.deepEqual(revoked.NBA_DB.queries,[]);
 const shadow=testEnv({SPORT_DB_MODE_NBA:"shadow"});
 await loadPropFixturesAndPlayers(shadow,opts);
 assert.ok(shadow.DB.queries.some(q=>q.includes("FROM games")));
 assert.deepEqual(shadow.NBA_DB.queries,[]);
});
test("NBA settlement backfill denies missing CORE approval before any ledger write",async()=>{
 const { onRequestPost }=await import("../functions/api/basketball-form-backfill.js");
 const env=testEnv({HARVEST_SECRET:"test-secret",
   CORE_DB:{prepare(){return {bind(){return this},all:async()=>({results:[]})}}}});
 const request=new Request("https://example.test/api/basketball-form-backfill",{
   method:"POST",headers:{"x-harvest-secret":"test-secret","content-type":"application/json"},
   body:JSON.stringify({sport:"nba",games:[{id:"test-game",date:"2026-10-23",homeScore:99,awayScore:101}]})
 });
 const response=await onRequestPost({env,request});
 assert.equal(response.status,503);
 assert.equal((await response.json()).error,"NBA_FORM_OWNER_UNAVAILABLE");
 assert.deepEqual(env.DB.queries,[]);
 assert.deepEqual(env.NBA_DB.queries,[]);
});
