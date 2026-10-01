import test from "node:test";
import assert from "node:assert/strict";
import { projectSoccerForm, SOCCER_FBIS_ID, SOCCER_LEAGUES } from "../functions/lib/soccerFbisV1.js";
import { SPORTS, BOARD_SPORTS } from "../functions/lib/slateEngineCore.js";

test("soccer six-league board is registered",()=>{
  assert.equal(SPORTS.soccer.id,"soccer");
  assert.ok(BOARD_SPORTS.includes("soccer"));
  assert.deepEqual(SOCCER_LEAGUES,["eng.1","esp.1","ger.1","ita.1","fra.1","usa.1"]);
});

test("Soccer-FBIS-v1 is independent and research-only",()=>{
  const p=projectSoccerForm({neutralSite:false},{
    homePrior:{games:38,pointsFor:70,pointsAgainst:35},
    awayPrior:{games:38,pointsFor:48,pointsAgainst:49},
    homeCurrent:{games:7,pointsFor:15,pointsAgainst:7},
    awayCurrent:{games:7,pointsFor:8,pointsAgainst:11},
  });
  assert.equal(p.ok,true);
  assert.equal(p.modelId,SOCCER_FBIS_ID);
  assert.equal(p.marketInformed,false);
  assert.equal(p.canQualify,false);
  assert.equal(p.canAuthorize,false);
  assert.ok(p.pHomeWin>p.pAwayWin);
  assert.ok(Math.abs(p.pHomeWin+p.pDraw+p.pAwayWin-1)<1e-6);
});
