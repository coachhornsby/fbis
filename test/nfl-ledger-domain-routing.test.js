import test from "node:test";
import assert from "node:assert/strict";
import { nflLedgerEnv } from "../functions/lib/nflLedgerRouting.js";
import { persistGame, persistPrediction, queryGames } from "../functions/lib/store.js";

function fakeDb(label, rows = []) {
 const calls=[];
 return {calls,prepare(sql) {
  let args=[];
  return {bind(...v){args=v;return this;},
   async run(){calls.push({label,kind:"write",sql,args});return {meta:{changes:1}};},
   async first(){calls.push({label,kind:"first",sql,args});return {ok:1};},
   async all(){calls.push({label,kind:"read",sql,args});return {results:rows};}
  };
 }};
}
function authorized() {
 const DB=fakeDb("primary",[
  {id:"nfl-old",sport:"nfl",date:"2026-10-21",start:"2026-10-22T01:00Z"},
  {id:"cfb-live",sport:"cfb",date:"2026-10-21",start:"2026-10-22T02:00Z"}]);
 const NFL_DB=fakeDb("nfl",[{id:"nfl-current",sport:"nfl",date:"2026-10-21",start:"2026-10-22T03:00Z"}]);
 const receipt="fixture";
 return {DB,NFL_DB,SPORT_DB_MODE_NFL:"sport",SPORT_CUTOVER_RECEIPT_NFL:receipt,
  __fbisCutoverApprovals:new Map([["nfl:"+receipt,{status:"APPROVED",receipt_id:receipt}]])};
}
const game={id:"nfl-123",sport:"nfl",start:"2026-10-22T01:00Z",home:{name:"A",abbr:"A"},away:{name:"B",abbr:"B"}};
test("shadow writes NFL game ledger to PRIMARY",async()=>{
 const env=authorized();env.SPORT_DB_MODE_NFL="shadow";
 assert.equal((await persistGame(env,game,"2026-10-21")).ok,true);
 assert.equal(env.DB.calls.length,1);assert.equal(env.NFL_DB.calls.length,0);
});
test("approved sport mode routes NFL game and prediction writes to NFL D1",async()=>{
 const env=authorized();
 await persistGame(env,game,"2026-10-21");
 await persistPrediction(env,{id:"nfl-pred",gameId:game.id,sport:"nfl",date:"2026-10-21",asOf:"2026-10-21T10:00Z"});
 assert.equal(env.DB.calls.length,0);assert.equal(env.NFL_DB.calls.length,2);
});
test("sport-mode receipt unavailable: NFL writes fail closed instead of splitting into PRIMARY",async()=>{
 const env=authorized();env.__fbisCutoverApprovals.clear();
 const r=await persistGame(env,game,"2026-10-21");
 assert.equal(r.ok,false);assert.equal(env.DB.calls.length,0);assert.equal(env.NFL_DB.calls.length,0);
});
test("cross-sport game queries take NFL rows only from approved shard",async()=>{
 const env=authorized();
 const r=await queryGames(env,{sport:"all",date:"2026-10-21"});
 assert.equal(r.ok,true);
 assert.deepEqual(r.rows.map(x=>x.id),["cfb-live","nfl-current"]);
 assert.equal(env.DB.calls.filter(x=>x.kind==="read").length,1);
 assert.equal(env.NFL_DB.calls.filter(x=>x.kind==="read").length,1);
});
test("CFB writes remain exclusively PRIMARY with NFL authority active",async()=>{
 const env=authorized();
 await persistGame(env,{...game,sport:"cfb"},"2026-10-21");
 assert.equal(env.DB.calls.length,1);assert.equal(env.NFL_DB.calls.length,0);
});
