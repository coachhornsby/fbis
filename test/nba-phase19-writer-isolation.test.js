import test from "node:test";
import assert from "node:assert/strict";
import { resolveNbaResearchOwnerDb } from "../functions/lib/nbaResearchOwnerDb.js";
import { persistGame,persistPrediction,persistSnapshot,persistOddsSnapshot,
  gradeSnapshotsForGame,upsertTeamForm,applyFinalToForm } from "../functions/lib/store.js";

function mockDb() {
 const statements=[];
 return {statements,prepare(sql){
   return {bind(...args){this.args=args;return this},
     async run(){statements.push(String(sql));return {success:true,meta:{changes:1,last_row_id:1}}},
     async first(){return null},
     async all(){return {results:[]}}};
 }};
}
const approval={receipt_id:"nba-writer-test-only",sport:"nba",status:"APPROVED",approved_at:"2026-10-23T12:00:00Z",revoked_at:null,expires_at:null};
function env(mode="sport",approved=true){
 const primary=mockDb(),shard=mockDb();
 const core={prepare(sql){assert.match(sql,/fbis_sport_cutover_approvals/);
   return {bind(){return this},all:async()=>({results:approved?[approval]:[]})}}};
 return {DB:primary,NBA_DB:shard,CORE_DB:core,
   SPORT_DB_MODE_NBA:mode,SPORT_DB_STRICT_NBA:"1",SPORT_DB_LEDGER_READY_NBA:"1",
   SPORT_CUTOVER_RECEIPT_NBA:approval.receipt_id};
}
async function exerciseWrites(e){
 const game={id:"nba-game",sport:"nba",start:"2026-10-24T00:00:00Z",
   home:{name:"Home",abbr:"HOM"},away:{name:"Away",abbr:"AWY"}};
 await persistGame(e,game,"2026-10-23");
 await persistPrediction(e,{id:"pred-test",sport:"nba",gameId:"nba-game",date:"2026-10-23",asOf:"2026-10-23T12:00:00Z"});
 await persistSnapshot(e,{id:"snap-test",sport:"nba",gameId:"nba-game",date:"2026-10-23",frozenAt:"2026-10-23T12:00:00Z"});
 await persistOddsSnapshot(e,{sport:"nba",gameId:"nba-game",date:"2026-10-23",book:"test",market:"spread",side:"HOME",capturedAt:"2026-10-23T12:00:00Z"});
 await upsertTeamForm(e,{sport:"nba",season:2026,team:{abbr:"HOM"},pointsFor:105,pointsAgainst:100});
 await applyFinalToForm(e,{sport:"nba",season:2026,gameId:"nba-game",date:"2026-10-23",
   home:{abbr:"HOM"},away:{abbr:"AWY"},homeScore:105,awayScore:100});
 await gradeSnapshotsForGame(e,{sport:"nba",gameId:"nba-game",actualHome:105,actualAway:100});
}
test("CORE-approved NBA writer routes resolve exclusively to NBA_DB across projection, odds and settlement",async()=>{
 const original=env();
 const owner=await resolveNbaResearchOwnerDb(original);
 assert.equal(owner.ok,true);
 assert.equal(owner.db,original.NBA_DB);
 assert.equal(owner.canAuthorizeWager,false);
 await exerciseWrites(owner.env);
 assert.deepEqual(original.DB.statements,[]);
 const sql=original.NBA_DB.statements.join("\n");
 for(const fragment of ["INSERT INTO games","INSERT OR REPLACE INTO predictions",
  "INSERT OR IGNORE INTO prediction_snapshots","INSERT INTO odds_snapshots",
  "INSERT INTO team_form","INSERT OR IGNORE INTO team_form_games",
  "UPDATE prediction_snapshots","UPDATE predictions"]){
   assert.ok(sql.includes(fragment),fragment);
 }
});
test("revoked approval cannot start NBA product writer preflight",async()=>{
 const x=env("sport",false);
 const owner=await resolveNbaResearchOwnerDb(x);
 assert.equal(owner.ok,false);
 assert.equal(owner.db,null);
 assert.deepEqual(x.DB.statements,[]);
 assert.deepEqual(x.NBA_DB.statements,[]);
});
test("NBA rollback to shadow returns all product writer ownership to PRIMARY",async()=>{
 const x=env("shadow");
 const owner=await resolveNbaResearchOwnerDb(x);
 assert.equal(owner.db,x.DB);
 await persistGame(owner.env,{id:"nba-shadow",sport:"nba",home:{name:"A"},away:{name:"B"}},"2026-10-23");
 assert.ok(x.DB.statements.some(s=>s.includes("INSERT INTO games")));
 assert.deepEqual(x.NBA_DB.statements,[]);
});

test("production NBA canary refuses shadow mode without touching either database",async()=>{
 const {onRequestPost}=await import("../functions/api/database-topology.js");
 const x={...env("shadow"),HARVEST_SECRET:"test-secret"};
 const request=new Request("https://example.test/api/database-topology",{
   method:"POST",headers:{"x-harvest-secret":"test-secret","content-type":"application/json"},
   body:JSON.stringify({operation:"nba-production-writer-canary"})
 });
 const response=await onRequestPost({env:x,request});
 assert.equal(response.status,409);
 assert.equal((await response.json()).ok,false);
 assert.deepEqual(x.DB.statements,[]);
 assert.deepEqual(x.NBA_DB.statements,[]);
});
test("production NBA canary refuses revoked CORE grant without touching PRIMARY",async()=>{
 const {onRequestPost}=await import("../functions/api/database-topology.js");
 const x={...env("sport",false),HARVEST_SECRET:"test-secret"};
 const request=new Request("https://example.test/api/database-topology",{
   method:"POST",headers:{"x-harvest-secret":"test-secret","content-type":"application/json"},
   body:JSON.stringify({operation:"nba-production-writer-canary"})
 });
 const response=await onRequestPost({env:x,request});
 assert.equal(response.status,409);
 assert.deepEqual(x.DB.statements,[]);
 assert.deepEqual(x.NBA_DB.statements,[]);
});

test("NBA reverse recovery is forbidden while normal sport writes may be active",async()=>{
 const {restorePausedNbaToPrimary}=await import("../functions/lib/sportWorkingCopy.js");
 const x={...env("sport"),NBA_ROLLBACK_RECOVERY_MODE:"paused"};
 const result=await restorePausedNbaToPrimary(x,{table:"games"});
 assert.equal(result.ok,false);
 assert.match(result.reason,/PAUSED_STRICT_MODE/);
 assert.deepEqual(x.DB.statements,[]);
 assert.deepEqual(x.NBA_DB.statements,[]);
});
test("paused NBA recovery copies only NBA-owned game into PRIMARY without deleting anything",async()=>{
 const {restorePausedNbaToPrimary}=await import("../functions/lib/sportWorkingCopy.js");
 const fields=[{name:"id",type:"TEXT",pk:1},{name:"sport",type:"TEXT",pk:0},{name:"start",type:"TEXT",pk:0}];
 const source={prepare(sql){return {bind(){return this},async all(){
   return {results:sql.startsWith("PRAGMA")?fields:sql.startsWith("SELECT *")?
     [{id:"nba-restore-fixture",sport:"nba",start:"2026-10-24T00:00:00Z"}]:[]};
 }}}};
 const writes=[];
 const target={prepare(sql){return {bind(...args){this.args=args;return this},async all(){return {results:fields}},
   async first(){return null},async run(){writes.push({sql,args:this.args});return {meta:{changes:1}}}}}};
 const e={DB:target,NBA_DB:source,SPORT_DB_MODE_NBA:"sport",SPORT_DB_STRICT_NBA:"1",
   NBA_ROLLBACK_RECOVERY_MODE:"paused"};
 const result=await restorePausedNbaToPrimary(e,{table:"games",pageSize:10});
 assert.equal(result.ok,true);
 assert.equal(result.complete,true);
 assert.equal(result.copied,1);
 assert.ok(writes.some(x=>x.sql.includes("INSERT OR REPLACE INTO games")));
 assert.ok(!writes.some(x=>/DELETE FROM/i.test(x.sql)));
 assert.equal(result.primaryDeletionCount,0);
});
