import test from "node:test";
import assert from "node:assert/strict";
import { projectBasketballForm, BASKETBALL_FORM_MODELS } from "../functions/lib/basketballFormModel.js";
import { SPORTS, BOARD_SPORTS } from "../functions/lib/slateEngineCore.js";

test("WNBA is registered as a core board sport",()=>{
  assert.equal(SPORTS.wnba.espn,"basketball/wnba");
  assert.ok(BOARD_SPORTS.includes("wnba"));
});

test("WNBA form model is independent and research-only",()=>{
  const p=projectBasketballForm("wnba",{neutralSite:false},{
    homePrior:{games:40,pointsFor:3360,pointsAgainst:3200},
    awayPrior:{games:40,pointsFor:3200,pointsAgainst:3320},
    homeCurrent:{games:20,pointsFor:1700,pointsAgainst:1600},
    awayCurrent:{games:20,pointsFor:1580,pointsAgainst:1680},
  });
  assert.equal(p.ok,true);
  assert.equal(p.modelId,"WNBA-FBIS-v1");
  assert.equal(p.marketInformed,false);
  assert.equal(p.canQualify,false);
  assert.equal(p.canAuthorize,false);
  assert.ok(Number.isFinite(p.home)&&Number.isFinite(p.away));
});

test("NBA form model never requires market prices",()=>{
  const p=projectBasketballForm("nba",{},{
    homePrior:{games:82,pointsFor:9400,pointsAgainst:9200},
    awayPrior:{games:82,pointsFor:9100,pointsAgainst:9300},
    homeCurrent:{games:10,pointsFor:1160,pointsAgainst:1110},
    awayCurrent:{games:10,pointsFor:1090,pointsAgainst:1160},
  });
  assert.equal(p.ok,true);
  assert.equal(p.modelId,BASKETBALL_FORM_MODELS.nba.modelId);
  assert.equal(p.provenance.marketUsed,false);
});
