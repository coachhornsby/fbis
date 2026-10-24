import test from "node:test";
import assert from "node:assert/strict";
import {gradeFootballProspective} from "../functions/api/football-sdv-prospective.js";
const now="2026-10-28T12:00:00Z";
const p={receiptId:"r1",gameId:"internal-01",sport:"cfb",
 homeTeamId:"cfb-a",awayTeamId:"cfb-b",
 capturedAt:"2026-10-24T01:00:00Z",kickoff:"2026-10-25T17:00:00Z"};
const outcome={sport:"cfb",sourceGameId:"provider-99",
 homeTeamId:"cfb-a",awayTeamId:"cfb-b",
 kickoff:"2026-10-25T17:08:00Z",sourceModel:"SDV_ESPN_CFB_PBP_DRIVES",
 sourceFingerprint:"f".repeat(64),observedAt:"2026-10-25T22:00:00Z",
 homeScore:28,awayScore:17};
function makeDb({receipts=[p],sources=[outcome],pending=2}={}){
 const writes=[],readQueries=[];
 const db={prepare(sql){
  readQueries.push(sql);
  return {bind(...params){
   return {
    async all(){
     if(sql.includes("FROM football_sdv_prospective_receipts r")&&sql.includes("AND EXISTS"))
      return {results:receipts};
     if(sql.includes("FROM football_sdv_verified_games WHERE sport=?"))
      return {results:sources};
     throw Error("UNRECOGNIZED_SQL:"+sql.slice(0,70));
    },
    async first(){
     if(sql.includes("SELECT COUNT(*) pending"))return {pending};
     throw Error("UNRECOGNIZED_FIRST:"+sql.slice(0,70));
    },
    async run(){
     if(!sql.startsWith("INSERT OR IGNORE INTO football_sdv_prospective_grades"))
      throw Error("UNAUTHORIZED_WRITE");
     writes.push(params);
     return {meta:{changes:1}};
    }
   };
  }};
 }};
 return {db,writes,readQueries};
}
test("Pregame forecasts are graded after official SDV result arrives",async()=>{
 const x=makeDb();
 const result=await gradeFootballProspective({CFB_DB:x.db},{sport:"cfb",now});
 assert.equal(result.ok,true);
 assert.equal(result.checked,1);
 assert.equal(result.graded,1);
 assert.equal(result.awaitingOfficialOutcome,1);
 assert.equal(result.canAuthorizeWager,false);
 assert.equal(x.writes.length,1);
 assert.equal(x.writes[0][0],p.receiptId);
 assert.equal(x.writes[0][3],outcome.sourceGameId);
 assert.equal(x.writes[0][6],outcome.observedAt);
 assert.equal(x.writes[0][7],28);
 assert.equal(x.writes[0][8],17);
 assert.ok(x.readQueries.some(q=>q.includes("AND EXISTS")));
});
test("Disputed official scores never write any grade",async()=>{
 const other={...outcome,sourceFingerprint:"b".repeat(64),awayScore:24};
 const x=makeDb({sources:[outcome,other],pending:1});
 const result=await gradeFootballProspective({CFB_DB:x.db},{sport:"cfb",now});
 assert.equal(result.graded,0);
 assert.equal(result.sourceConflicts,1);
 assert.equal(x.writes.length,0);
});
test("No verified source yet cannot block later source-eligible game",async()=>{
 const x=makeDb({receipts:[],sources:[],pending:30});
 const result=await gradeFootballProspective({CFB_DB:x.db},{sport:"cfb",now});
 assert.equal(result.checked,0);
 assert.equal(result.pendingNotGraded,30);
 assert.equal(result.awaitingOfficialOutcome,30);
 assert.equal(result.graded,0);
 assert.equal(x.writes.length,0);
});
test("Missing sport binding fails closed without fallback to PRIMARY",async()=>{
 await assert.rejects(
  gradeFootballProspective({DB:makeDb().db},{sport:"nfl",now}),
  /SPORT_DB_UNBOUND/);
});
