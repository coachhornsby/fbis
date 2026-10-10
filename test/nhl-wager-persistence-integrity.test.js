import test from "node:test";
import assert from "node:assert/strict";
import {nhlWagerGameRows} from "../functions/api/nhl-wager-research.js";
import {evaluateNhlGameWagers} from "../functions/lib/nhlWagerV1.js";

test("unverified OT-unsafe markets and quotes never become wager-research economic rows",()=>{
  const offers=[
    {market:"total",selection:"over",americanPrice:-110,
      modelProbability:.75,calibratedProbability:.75,expectedRoi:.52,
      marketProbabilityUsePermitted:false,researchCandidate:true,decision:"BET",canQualify:true},
    {market:"moneyline",selection:"home",americanPrice:140,
      modelProbability:.64,calibratedProbability:null,
      marketProbabilityUsePermitted:false,researchCandidate:true,decision:"BET",canQualify:true}
  ];
  const board={games:[{id:"nhl-fixture-1",sport:"nhl",start:"2026-10-11T23:00:00Z",
    nhlWagerV1:{ok:true,modelId:"NHL-WAGER-v1",version:"test",offers}}]};
  const before=JSON.stringify(board);
  assert.deepEqual(nhlWagerGameRows(board,"2026-10-11T21:00:00Z"),[]);
  assert.equal(JSON.stringify(board),before);
});

test("GAME archive forcibly records PASS/no qualification even when caller forges BET and approved market",()=>{
  const offers=[{market:"moneyline",selection:"home",americanPrice:140,modelProbability:.64,
    calibratedProbability:.64,expectedRoi:.536,breakEvenProbability:.4167,
    marketNoVigProbability:.4,probabilityEdge:.24,confidence:90,
    confidenceVersion:"test",confidenceStatus:"VALIDATED",decision:"BET",canQualify:true,
    marketProbabilityUsePermitted:true,researchCandidate:true,
    quoteProvenance:{ok:true,marketScope:"FULL_GAME_INCLUDING_OT_SHOOTOUT"},
    sourceIntegrityVerified:true,settlementScopeVerified:true,
    probabilityStatus:"VERIFIED_PRICE_RESEARCH_ONLY"}];
  const board={games:[{id:"nhl-fixture-2",sport:"nhl",start:"2026-10-11T23:00:00Z",
    nhlWagerV1:{ok:true,modelId:"NHL-WAGER-v1",version:"test",offers}}]};
  const rows=nhlWagerGameRows(board,"2026-10-11T21:00:00Z");
  assert.equal(rows.length,1);
  assert.equal(rows[0].decision,"PASS");
  assert.equal(rows[0].canQualify,false);
  assert.equal(rows[0].canAuthorizeWager,false);
  assert.equal(rows[0].researchCandidate,true);
  assert.equal(rows[0].trajectory.quoteProvenance.ok,true);
  assert.equal(rows[0].trajectory.probabilityStatus,"VERIFIED_PRICE_RESEARCH_ONLY");
});
test("actual invalid GAME evaluator output cannot be archived as economic EV",()=>{
  const game={
    id:"nhl-test",sport:"nhl",start:"2026-10-12T23:00:00Z",
    home:{abbr:"BOS"},away:{abbr:"WPG"},
    odds:{pinHomeMl:140,pinAwayMl:-155,pinSpread:-1.5,pinSpreadHomePrice:180,
      pinSpreadAwayPrice:-200,pinTotal:6,pinOverPrice:-110,pinUnderPrice:-110},
    nhlProV2:{ok:true,modelId:"NHL-PRO-v2",home:"BOS",away:"WPG",
      projHome:3.4,projAway:3.1,probability:{homeWinIncludingOt:.60,awayWinIncludingOt:.40}}
  };
  const out=evaluateNhlGameWagers(game);
  assert.ok(out.offers.length>=4);
  assert.ok(out.offers.every(x=>x.calibratedProbability==null&&x.expectedRoi==null));
  assert.ok(out.offers.every(x=>!x.researchCandidate&&!x.canQualify&&x.decision==="PASS"));
  assert.deepEqual(nhlWagerGameRows({games:[{...game,nhlWagerV1:out}]},"2026-10-12T21:00:00Z"),[]);
});
