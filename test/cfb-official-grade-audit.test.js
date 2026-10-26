import test from "node:test";
import assert from "node:assert/strict";
import {grade} from "../scripts/cfb-official-grade-audit.mjs";
const game={game_id:"1",week:5,kickoff_literal:"2026-10-03 16:00:00",home_team_source:"Home",away_team_source:"Away"};
const p={game_id:"1",frozen_at:"2026-10-01T08:00:00Z",model_version:"CFB-FBIS-v2",proj_home:27,proj_away:20};
const result={game_id:"1",verified:true,source_url:"https://example.edu/boxscore",home_team:"Home",away_team:"Away",home_score:24,away_score:17};
test("official source and earliest legitimate frozen prediction produce exact grade",()=>{
 const r=grade([game],[p], [result]);assert.equal(r.graded,1,JSON.stringify(r.rows[0]));assert.equal(r.marginMAE,0);assert.equal(r.totalMAE,6);assert.equal(r.winnerAccuracy,1);assert.equal(r.modelPromotion,false);
});
test("unverified finals and late predictions remain ungraded",()=>{
 assert.equal(grade([game],[p],[{...result,verified:false}]).graded,0);
 assert.equal(grade([game],[{...p,frozen_at:"2026-10-04T08:00:00Z"}],[result]).graded,0);
});
test("reject missing score and orientation mismatch",()=>{
 assert.equal(grade([game],[p],[{...result,home_score:null}]).graded,0);
 assert.equal(grade([game],[p],[{...result,home_team:"Away"}]).graded,0);
});
test("duplicate official results are rejected",()=>{
 assert.throws(()=>grade([game],[p],[result,result]),/DUPLICATE/);
});
