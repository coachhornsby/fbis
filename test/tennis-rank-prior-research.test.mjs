import test from "node:test";
import assert from "node:assert/strict";
import {rankPriorTennisResearchEstimate} from "../functions/lib/tennisIntelligenceBank.js";

test("two distinct sourced ranks produce weak, symmetric but never bettor-qualified research probability",()=>{
 const r=rankPriorTennisResearchEstimate([{rank:41},{rank:96}]);
 assert.ok(r.player1WinProb>.5);
 assert.ok(r.player1WinProb<.65);
 assert.equal(r.player1WinProb+r.player2WinProb,1);
 assert.equal(r.confidence,"VERY_LOW");
 assert.equal(r.source,"RANK_PRIOR_RESEARCH_ONLY");
 assert.equal(r.canAuthorizeWager,false);
 assert.equal(r.canQualify,false);
 assert.equal(r.marketInformed,false);
});
test("identical rankings have symmetric prior, insufficient or bad ranks remain unavailable",()=>{
 assert.equal(rankPriorTennisResearchEstimate([{rank:158},{rank:158}]).player1WinProb,.5);
 assert.equal(rankPriorTennisResearchEstimate([{rank:158},{rank:null}]),null);
 assert.equal(rankPriorTennisResearchEstimate([{rank:1},{rank:4000}]),null);
 assert.equal(rankPriorTennisResearchEstimate([{rank:0},{rank:158}]),null);
});
