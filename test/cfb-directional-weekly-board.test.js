import test from "node:test";
import assert from "node:assert/strict";
import {buildCfbDirectionalBoardMap,loadCfbDirectionalBoardResearch} from "../functions/lib/cfbDirectionalBoardResearch.js";

const now="2026-10-15T22:00:00Z",start="2026-10-15T23:30:00Z";
const game={id:"401862800",sport:"cfb",start,
 home:{name:"UAB"},away:{name:"East Carolina"}};
const cfbd={
 game_id:game.id,season:2026,week:7,snapshot_season:2026,snapshot_week:7,
 snapshot_status:"research_only",authority:"research_only",identity_status:"matched_unique_active_fbs",
 can_influence_projection:0,can_authorize_wager:0,received_at:"2026-10-15T07:31:57.034Z",
 homePassOff:.03759457,homePassDef:.11613232,awayPassOff:.10853457,awayPassDef:.11122955,
 homeRushOff:.04744398,homeRushDef:.08703997,awayRushOff:.04421001,awayRushDef:.05221003,
};
const sdv={game_id:game.id,season:2026,source_version:"cfb-sdv-source-observed-research-v1",
 feature_as_of_timestamp:"2026-10-15T20:50:30.313Z",collection_timestamp:"2026-10-15T20:50:29.883Z",
 homeGames:5,awayGames:4,
 homePassOff:-.05725799,homePassDef:-.00956405,awayPassOff:-.21414054,awayPassDef:-.12567780,
 homeRushOff:.08769027,homeRushDef:.08928830,awayRushOff:-.04661096,awayRushDef:-.11397835,
};
test("private Week 7 adjusted CFBD differences drive CFB display and flag SDV directional reversal",()=>{
 const report=buildCfbDirectionalBoardMap([game],[cfbd],[sdv],{now});
 assert.equal(report.cfbdGames,1);
 assert.equal(report.sdvGames,1);
 const x=report.byGameId[game.id];
 assert.equal(x.season,2026);assert.equal(x.week,7);
 assert.equal(x.rows.length,4);
 assert.equal(x.rows.find(r=>r.id==="away-pass-defense").cfbdDifference,-.074);
 assert.equal(x.rows.find(r=>r.id==="away-pass-defense").sdvDifference,.068);
 assert.equal(x.rows.find(r=>r.id==="away-pass-defense").disagreement,true);
 assert.equal(x.rows.find(r=>r.id==="away-pass-offense").cfbdDifference,-.008);
 assert.equal(x.disagreements,1);
 assert.equal(x.sdv.homeGames,5);assert.equal(x.sdv.awayGames,4);
 assert.equal(x.canQualify,false);assert.equal(x.canAuthorizeWager,false);
 assert.equal(x.projectionInputsChanged,false);assert.equal(x.sourceCutoffVerified,false);
 assert.equal(JSON.stringify(x).includes("homePassOff"),false);
 assert.equal(JSON.stringify(x).includes("features_json"),false);
});
test("post-kickoff CFBD receipt, mismatched identity, or forbidden authority excludes private source",()=>{
 for(const patch of [{received_at:"2026-10-16T00:00:00Z"},{identity_status:"ambiguous"},{can_influence_projection:1},{snapshot_status:"promoted"},{snapshot_week:8}]){
  const result=buildCfbDirectionalBoardMap([game],[{...cfbd,...patch}],[sdv],{now});
  assert.equal(result.cfbdGames,0);
  assert.equal(result.byGameId[game.id].source,"SDV_2026_SEASON");
 }
});
test("SDV observed after game kickoff is excluded, and unknown games cannot join",()=>{
 assert.equal(buildCfbDirectionalBoardMap([game],[],[{...sdv,feature_as_of_timestamp:"2026-10-16T00:00:00Z"}],{now}).sdvGames,0);
 assert.equal(buildCfbDirectionalBoardMap([game],[{...cfbd,game_id:"401999999"}],[{...sdv,game_id:"401999999"}],{now}).cfbdGames,0);
});
test("bounded separate D1 data access derives values without emitting licensed rows",async()=>{
 const queries=[],DB={
  prepare(sql){return {bind(...ids){queries.push({sql,ids});return {all:async()=>({results:sql.includes("cfb_tier3_training_games")?[cfbd]:[sdv]})}}}}
 };
 const result=await loadCfbDirectionalBoardResearch({DB,TIER3_DB:DB},[game],{now});
 assert.equal(queries.length,2);
 assert.ok(queries.some(q=>q.sql.includes("cfb_tier3_training_games")));
 assert.ok(queries.some(q=>q.sql.includes("cfb_pregame_feature_vectors")));
 assert.deepEqual(queries[0].ids,[game.id]);
 assert.equal(result.byGameId[game.id].rows[2].disagreement,true);
 assert.ok(!JSON.stringify(result).includes("homePassOff"));
});
