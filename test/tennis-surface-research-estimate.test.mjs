import test from "node:test";
import assert from "node:assert/strict";
import {surfaceEloResearchEstimate} from "../functions/lib/tennisIntelligenceBank.js";
const player=(elo,matches=12)=>({profiles:[{surface:"hard",lastMatchDate:"2026-05-25",source:"RESEARCH",profile:{surfaceMatches:matches,surfaceElo:{hard:elo}}}]});
test("surface Elo research estimate is probability-normalized and never actionable",()=>{
 const x=surfaceEloResearchEstimate([player(1600),player(1400)],{surface:"hard"});
 assert.ok(x.player1WinProb>0.7 && x.player1WinProb<0.8);
 assert.equal(x.player1WinProb+x.player2WinProb,1);
 assert.equal(x.canQualify,false);
 assert.equal(x.canAuthorizeWager,false);
 assert.equal(x.marketInformed,false);
});
test("unknown surface, missing profile, weak sample and absent official display fail closed",()=>{
 const p=[player(1600),player(1400)];
 assert.equal(surfaceEloResearchEstimate(p,null),null);
 assert.equal(surfaceEloResearchEstimate(p,{surface:"unknown"}),null);
 assert.equal(surfaceEloResearchEstimate([player(1600,2),player(1400)],{surface:"hard"}),null);
 assert.equal(surfaceEloResearchEstimate([player(1600),{profiles:[]}],{surface:"hard"}),null);
});
