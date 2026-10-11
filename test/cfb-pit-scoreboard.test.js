import test from "node:test";
import assert from "node:assert/strict";
import {auditCfbFrozenDatabaseRows} from "../functions/api/cfb-pit-scoreboard.js";
const t={game_id:"401test",start:"2026-10-10T18:00:00Z",home_name:"Kentucky Wildcats",away_name:"LSU Tigers",frozen_at:"2026-10-10T16:00:00Z",proj_home:28,proj_away:25,actual_home:null,actual_away:null,graded_at:null};
test("CFB research scoreboard demands authenticated PIT features and after-kickoff grading",()=>{
 const final={...t,graded_at:"2026-10-10T23:00:00Z",actual_home:35,actual_away:34};
 const feature={game_id:t.game_id,feature_as_of_timestamp:"2026-10-10T15:00:00Z",kickoff_timestamp:t.start};
 const audit=auditCfbFrozenDatabaseRows([t,final],[feature]);
 assert.equal(audit.strictPitGames,1);assert.equal(audit.suspiciousPrematureGrades,0);
 assert.equal(audit.governance.canAuthorizeWager,false);
 const without=auditCfbFrozenDatabaseRows([t,final],[]);
 assert.equal(without.strictPitGames,0);
 const impossible=auditCfbFrozenDatabaseRows([t,{...final,graded_at:"2026-10-09T23:00:00Z"}],[feature]);
 assert.equal(impossible.strictPitGames,0);assert.equal(impossible.suspiciousPrematureGrades,1);
});
