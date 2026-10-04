import test from "node:test";
import assert from "node:assert/strict";
import { attachWnbaPlayerProjectionResearch } from "../functions/lib/wnbaPlayerProjection.js";

test("WNBA player engine emits independent wager-authorized projections for curated markets",()=>{
  const games=[{id:"g1",home:{abbr:"LVA"},away:{abbr:"IND"},researchProjection:{home:86,away:81}}];
  const ctx={byTeam:{
    LVA:[{id:"1",name:"Player A",position:"F",games:30,minutes:32,points:20,rebounds:8,assists:3,threes:1.2}],
    IND:[{id:"2",name:"Player B",position:"G",games:28,minutes:31,points:18,rebounds:4,assists:6,threes:2.1}],
  },meta:{source:"TEST"}};
  const out=attachWnbaPlayerProjectionResearch(games,ctx);
  assert.equal(out.games.length,1);
  assert.equal(out.games[0].playerProjectionRows.length,16);
  assert.deepEqual([...new Set(out.games[0].playerProjectionRows.map(x=>x.market))].sort(),["assists","points","points_assists","points_rebounds","points_rebounds_assists","rebounds","rebounds_assists","three_pointers_made"]);
  assert.ok(out.games[0].playerProjectionRows.every(x=>x.independent===true&&x.marketInformed===false&&x.canQualify===true&&x.canAuthorizeWager===true&&Number.isFinite(x.fbisSigma)));
  assert.ok(out.games[0].playerProjectionRows.every(x=>x.eligibleForCard===true&&x.decisionEligible===true&&x.propGate==="CLEAR"));
});

test("WNBA player engine excludes low-minute players",()=>{
  const games=[{id:"g1",home:{abbr:"LVA"},away:{abbr:"IND"},researchProjection:{home:82,away:82}}];
  const ctx={byTeam:{LVA:[{id:"1",name:"Bench",minutes:8,games:20,points:5,rebounds:2,assists:1,threes:.5}],IND:[]}};
  const out=attachWnbaPlayerProjectionResearch(games,ctx);
  assert.equal(out.games[0].playerProjectionRows.length,0);
});
