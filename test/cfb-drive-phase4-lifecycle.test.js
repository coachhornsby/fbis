import test from "node:test";
import assert from "node:assert/strict";
import {
 eligibleCfbDriveProspectiveGames,gradeReadyCfbDriveCohort,
} from "../functions/lib/cfbDrivePhase4Lifecycle.js";
import {onRequestGet,onRequestPost} from "../functions/api/cfb-simulation.js";
const now="2026-10-22T16:00:00.000Z";

test("Phase 4 refuses primary-only DB and invalid clocks before running",async()=>{
 const env={DB:{prepare(){throw Error("PRIMARY_DB_WRONG")}}};
 await assert.rejects(eligibleCfbDriveProspectiveGames(env),/CFB_DB_UNBOUND/);
 await assert.rejects(gradeReadyCfbDriveCohort(env),/CFB_DB_UNBOUND/);
 const cfb={prepare(){throw Error("UNEXPECTED_QUERY")}};
 await assert.rejects(eligibleCfbDriveProspectiveGames({CFB_DB:cfb},{now:"nonsense"}),/INVALID_CLOCK/);
 await assert.rejects(gradeReadyCfbDriveCohort({CFB_DB:cfb},{now:"nonsense"}),/INVALID_CLOCK/);
});

test("Upcoming queue excludes kickoff-started and already frozen games, anchored as-of",async()=>{
 let sqlText="",values=[];
 const row={gameId:"401856725",kickoff:"2026-10-24T19:30:00Z",
   home:"Alabama",away:"Texas A&M",sourceSnapshotId:"snap",sourceFrozenAt:"2026-10-21T19:00:00Z"};
 const env={CFB_DB:{prepare(sql){sqlText=sql;return {bind(...args){values=args;return {all:async()=>({results:[row]})}}}}}};
 const result=await eligibleCfbDriveProspectiveGames(env,{now,limit:30,horizonDays:7});
 assert.equal(result.eligible,1);
 assert.equal(result.games[0].gameId,row.gameId);
 assert.equal(result.source,"CFB_DB");
 assert.equal(result.providerRequests,0);
 assert.equal(result.canAuthorizeWager,false);
 assert.match(sqlText,/e\.start>\?/);
 assert.match(sqlText,/NOT EXISTS/);
 assert.match(sqlText,/cfb_drive_shadow_runs/);
 assert.match(sqlText,/model_version='CFB-FBIS-v2'/);
 assert.equal(values[0],now);
 assert.equal(values[2],now);
 assert.equal(values[3],now);
 assert.equal(values[4],30);
});

test("A zero-result verified result pass is successful without network requests",async()=>{
 const env={CFB_DB:{prepare(sql){
   assert.match(sql,/JOIN cfb_drive_verified_games/);
   assert.match(sql,/verified_against_game=1/);
   assert.match(sql,/LEFT JOIN cfb_drive_shadow_grades/);
   return {bind(){return {all:async()=>({results:[]})}}};
 }}};
 const r=await gradeReadyCfbDriveCohort(env,{now});
 assert.deepEqual(r.details,[]);
 assert.equal(r.graded,0);
 assert.equal(r.providerRequests,0);
 assert.equal(r.canAuthorizeWager,false);
});

test("Real verified source goes into existing D1 grade ledger only",async()=>{
 const sqls=[];
 const source={source_fingerprint:"v1",actual_home:27,actual_away:23,
    source_observed_at:"2026-10-25T17:00:00Z"};
 const distributions={total:{p05:20,p10:30,p25:40,p50:52,p75:60,p90:70,p95:80},
                    margin:{p05:-30,p10:-20,p25:-10,p50:4,p75:12,p90:20,p95:30}};
 const env={CFB_DB:{prepare(sql){
  sqls.push(sql);
  const row=sql.includes("SELECT DISTINCT r.game_id")?[{gameId:"401856727"}]
    :sql.includes("sqlite_master")?[{name:"cfb_drive_verified_games"},{name:"cfb_drive_shadow_runs"},{name:"cfb_drive_shadow_grades"}]
    :sql.includes("LEFT JOIN cfb_drive_shadow_grades")?[{id:"run-1",distributions_json:JSON.stringify(distributions)}]
    :[];
  return {bind(){return{all:async()=>({results:row}),first:async()=>source,
    run:async()=>({meta:{changes:1}})}} ,
    all:async()=>({results:row})};
 }}};
 const r=await gradeReadyCfbDriveCohort(env,{now:"2026-10-26T18:00:00Z"});
 assert.equal(r.graded,1);
 assert.equal(r.providerRequests,0);
 assert.ok(sqls.some(s=>s.includes("INSERT OR IGNORE INTO cfb_drive_shadow_grades")));
 assert.ok(sqls.every(s=>!s.includes("UPDATE prediction_snapshots")));
});

test("All new operator routes retain authentication",async()=>{
 const env={HARVEST_SECRET:"offline-test",DB:{prepare(){throw Error("PRIMARY_UNSAFE")}}};
 const get=new Request("https://test.test/api/cfb-simulation?mode=eligible");
 const post=new Request("https://test.test/api/cfb-simulation",{method:"POST",body:'{"action":"drive-grade-ready"}'});
 assert.equal((await onRequestGet({request:get,env})).status,401);
 assert.equal((await onRequestPost({request:post,env})).status,401);
});
