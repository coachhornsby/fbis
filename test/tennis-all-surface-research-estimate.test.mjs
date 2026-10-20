import test from "node:test";
import assert from "node:assert/strict";
import {allSurfaceEloResearchEstimate} from "../functions/lib/tennisIntelligenceBank.js";
const make=(hard,clay)=>({profiles:[
 {surface:"hard",lastMatchDate:"2026-05-25",source:"RESEARCH",profile:{surfaceMatches:20,surfaceElo:{hard}}},
 {surface:"clay",lastMatchDate:"2026-05-25",source:"RESEARCH",profile:{surfaceMatches:10,surfaceElo:{clay}}},
]});
test("historical cross-surface estimate never claims verified surface, model authority or wager",()=>{
 const x=allSurfaceEloResearchEstimate([make(1600,1500),make(1400,1450)]);
 assert.ok(x.player1WinProb>.5);
 assert.equal(x.player1WinProb+x.player2WinProb,1);
 assert.equal(x.surface,null);
 assert.equal(x.canQualify,false);
 assert.equal(x.canAuthorizeWager,false);
 assert.match(x.uncertainty,/SURFACE_UNVERIFIED/);
});
test("missing and thin research samples fail closed rather than manufacturing a projection",()=>{
 assert.equal(allSurfaceEloResearchEstimate([{profiles:[]},make(1450,1500)]),null);
 assert.equal(allSurfaceEloResearchEstimate([{profiles:[{surface:"hard",lastMatchDate:"2026-05-25",profile:{surfaceMatches:2,surfaceElo:{hard:1600}}}]},make(1450,1500)]),null);
});
