import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildNhlCardEvidence } from "../src/lib/nhlCardEvidence.js";
import { bestEdge } from "../src/lib/boardEvidence.js";

function game(){
  return {sport:"nhl",id:"nhl-test",start:"2026-10-10T23:00:00Z",home:{abbr:"CGY"},away:{abbr:"ANA"},
    nhlProV2:{ok:true,modelId:"NHL-PRO-v2",modelVersion:"research-v2",
      home:"CGY",away:"ANA",projHome:3.3,projAway:3.1,
      probability:{homeWinIncludingOt:.543,awayWinIncludingOt:.457},
      layers:{goalie:{home:{name:"Goalie C",goalieId:"12"},away:{name:"Goalie A",goalieId:"16"}}}},
    nhlUnifiedMoneylineShadow:{probabilityAudit:{ok:true}},
    nhlGoalieProbabilityShadow:{starterEvidence:{home:{state:"CONFIRMED_STARTER",lineupMatched:true,evidenceAt:"2026-10-10T18:00:00Z"},away:{state:"EXPECTED_G1",lineupMatched:true}}},
    matchupFactors:[{id:"five-v-five",label:"5v5 xG",available:true}],
  };
}
function view(){return {sport:"nhl",away:{abbr:"ANA"},home:{abbr:"CGY"},market:{homeMl:-120,awayMl:+110,role:"REFERENCE_MARKET",book:"Pinnacle"},action:{available:false}};}
test("NHL card reports researched probabilities, reference quote, and each goalie status without granting authority",()=>{
  const e=buildNhlCardEvidence(game(),view());
  assert.equal(e.moneyline.valid,true);
  assert.equal(e.moneyline.home,"54.3%");
  assert.equal(e.moneyline.away,"45.7%");
  assert.equal(e.market.home,"-120");
  assert.equal(e.market.away,"+110");
  assert.equal(e.market.role,"REFERENCE ONLY");
  assert.equal(e.goalies.home.state,"CONFIRMED");
  assert.equal(e.goalies.away.state,"PROJECTED");
  assert.equal(e.qualified,false);
  assert.equal(e.researchOnly,true);
  assert.equal(e.coverage.action,"UNAVAILABLE");
});
test("NHL moneyline integrity hold suppresses apparently attractive percentages",()=>{
  const g=game();g.nhlUnifiedMoneylineShadow.probabilityAudit={ok:false,reasons:["HOME_AWAY_IDENTITY_MISMATCH"]};
  const e=buildNhlCardEvidence(g,view());assert.equal(e.moneyline.valid,false);
  assert.equal(e.moneyline.home,null);assert.equal(e.moneyline.integrity,"INTEGRITY HOLD");
});
test("NHL game identity mismatch is not treated as a reliable moneyline",()=>{
  const g=game();g.nhlProV2.home="ANA";
  assert.equal(buildNhlCardEvidence(g,view()).moneyline.valid,false);
});
test("NHL missing scores, market and goalies stay explicit and never become zero prices",()=>{
  const g={sport:"nhl",home:{abbr:"CGY"},away:{abbr:"ANA"}};
  const v={sport:"nhl",home:{abbr:"CGY"},away:{abbr:"ANA"},market:{},action:{available:false}};
  const e=buildNhlCardEvidence(g,v);
  assert.equal(e.moneyline.valid,false);assert.equal(e.market.role,"NO TIMESTAMPED MONEYLINE QUOTE");
  assert.equal(e.coverage.projection,"UNAVAILABLE");assert.equal(e.coverage.goalies,"UNAVAILABLE");
  assert.equal(e.market.home,"—");
});
test("historical moneyline snapshot is labeled archived, never current execution",()=>{
  const g=game();g.marketLineHistory=[
    {market:"ml",selection:"home",sportsbook:"Reference",americanPrice:-112,collectedAt:"2026-10-10T16:00:00Z"},
    {market:"ml",selection:"away",sportsbook:"Reference",americanPrice:102,collectedAt:"2026-10-10T16:00:00Z"},
    {market:"ml",selection:"home",sportsbook:"Reference",americanPrice:-500,collectedAt:"2026-10-11T01:00:00Z"}
  ];
  const v={...view(),market:{}};
  const e=buildNhlCardEvidence(g,v);
  assert.equal(e.market.home,"-112");assert.equal(e.market.away,"+102");
  assert.match(e.market.role,/ARCHIVED/);assert.equal(e.coverage.moneyline,"HISTORICAL_ONLY");
});
test("missing model or market means unevaluated, not NO EDGE",()=>{
  const base={projection:{available:false},market:{available:false,referenceOnly:false},comparison:{}};
  assert.equal(bestEdge(base).detail,"NO INDEPENDENT MODEL");
  assert.equal(bestEdge({...base,projection:{available:true}}).detail,"NO CURRENT MARKET");
  assert.equal(bestEdge({...base,projection:{available:true},market:{available:true}}).detail,"NO COMPARABLE LINE");
});
test("NHL compact and expanded cards share evidence contract and avoid unconditional edge badges",async()=>{
  const compact=await readFile(new URL("../src/components/board/CompactGameCard.jsx",import.meta.url),"utf8");
  const premium=await readFile(new URL("../src/components/board/PremiumGameCard.jsx",import.meta.url),"utf8");
  const component=await readFile(new URL("../src/components/board/NhlEvidenceStrip.jsx",import.meta.url),"utf8");
  for(const code of [compact,premium]) {
    assert.match(code,/NhlEvidenceStrip/);
    assert.match(code,/[Mm]odel \/ market gap|MODEL \/ MARKET GAP/);
  }
  assert.doesNotMatch(component,/canAuthorizeWager\s*:\s*true/);
  assert.match(compact,/LIVE SCORE NOT AVAILABLE FROM FEED/);
  assert.match(premium,/LIVE SCORE NOT AVAILABLE FROM FEED/);
});
