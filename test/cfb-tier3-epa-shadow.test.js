import test from "node:test";import assert from "node:assert/strict";
import {tier3ShadowProjection,pairedTier3ShadowAudit} from "../functions/lib/cfbTier3EpaShadow.js";
const row={gameId:"401858273",identityStatus:"matched",homeCanonicalId:"cfb-59",awayCanonicalId:"cfb-103",kickoff:"2026-10-24T18:00:00Z",receivedAt:"2026-10-20T06:00:00Z",baselineFrozenAt:"2026-10-23T00:00:00Z",baselineHome:30,baselineAway:20,homePassOff:.2,awayPassOff:.1,homeRushOff:.1,awayRushOff:.05,homePassDef:-.1,awayPassDef:.1,homeRushDef:-.05,awayRushDef:.05};
test("prekickoff CFBD receipts generate distinct research-only margin ablations and identical totals",()=>{
 const p=tier3ShadowProjection(row);assert.equal(p.ok,true);assert.equal(p.predictions.combined.total,50);
 assert.equal(p.predictions.pass.total,50);assert.notEqual(p.predictions.combined.margin,p.baseline.margin);
 assert.equal(p.canAuthorizeWager,false);assert.equal(p.trained,false);
});
test("post kickoff and ambiguous identifiers fail closed",()=>{
 assert.equal(tier3ShadowProjection({...row,receivedAt:"2026-10-25T00:00:00Z"}).ok,false);
 assert.equal(tier3ShadowProjection({...row,identityStatus:"partial_match"}).ok,false);
 assert.equal(tier3ShadowProjection({...row,awayCanonicalId:"cfb-59"}).ok,false);
});
test("paired report never fabricates unobserved finals",()=>{
 const p=tier3ShadowProjection(row);const empty=pairedTier3ShadowAudit([p],[]);
 assert.equal(empty.pairedGames,0);assert.equal(empty.metrics.combined.marginMAE,null);
 const actual=pairedTier3ShadowAudit([p],[{gameId:row.gameId,home:31,away:21,verified:true}]);
 assert.equal(actual.pairedGames,1);assert.equal(actual.metrics.baseline.marginMAE,0);
 assert.equal(actual.promotionEligible,false);
});
