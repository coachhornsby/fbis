import test from "node:test";
import assert from "node:assert/strict";
import {
  americanBreakEven,
  expectedValuePerUnit,
  distributionProbability,
  decisionFromOffer,
} from "../functions/lib/wagerDecisionEngine.js";
import {
  buildWnbaOffers,
  decomposeWnbaProjection,
  deriveWnbaMarketTrajectory,
  buildWnbaGameDecisions,
} from "../functions/lib/wnbaWagerDecision.js";

test("price math uses actual American odds and no market shrink",()=>{
  assert.ok(Math.abs(americanBreakEven(-110)-0.5238095)<1e-6);
  assert.ok(expectedValuePerUnit(0.56,-110)>0);
  const p=distributionProbability({
    market:"SPREAD",side:"HOME",line:-3.5,
    meanMargin:6,sigmaMargin:10,meanTotal:160,sigmaTotal:12,pHomeWin:.67,
  });
  assert.ok(p>0.5&&p<0.7);
});

test("WNBA current offers carry actual side-specific juice",()=>{
  const offers=buildWnbaOffers({
    odds:{
      heritageListed:true,spread:-4.5,total:163.5,
      heritageSpreadHomePrice:-115,heritageSpreadAwayPrice:-105,
      heritageOverPrice:-108,heritageUnderPrice:-112,
      heritageHomeMl:-180,heritageAwayMl:155,
    },
  });
  assert.equal(offers.length,6);
  assert.equal(offers.find(x=>x.market==="SPREAD"&&x.side==="HOME").price,-115);
  assert.equal(offers.find(x=>x.market==="TOTAL"&&x.side==="UNDER").price,-112);
});

test("ACTION trajectory stays separate and captures opening/current velocity/reversal",()=>{
  const rows=[
    {market_type:"spread",selection:"home",line:-2.5,american_price:-110,collected_at:"2026-07-01T12:00:00Z",public_ticket_pct:65,public_money_pct:54},
    {market_type:"spread",selection:"home",line:-3.5,american_price:-110,collected_at:"2026-07-01T14:00:00Z",public_ticket_pct:64,public_money_pct:55},
    {market_type:"spread",selection:"home",line:-3,american_price:-115,collected_at:"2026-07-01T16:00:00Z",public_ticket_pct:63,public_money_pct:51},
  ];
  const intel=deriveWnbaMarketTrajectory(rows,{market:"SPREAD",side:"HOME",line:-3,price:-115},{margin:6,total:160});
  assert.equal(intel.snapshotCount,3);
  assert.equal(intel.opening.line,-2.5);
  assert.equal(intel.current.line,-3);
  assert.equal(intel.reversal,true);
  assert.equal(intel.sharpSteamAvailable,false);
  assert.match(intel.note,/does not alter/);
});

test("projection decomposition explicitly reports factor coverage and market independence",()=>{
  const game={
    neutralSite:false,
    availabilityImpact:{configured:true,stale:false,home:{impactedCount:1},away:{impactedCount:0}},
    wnbaV2:{
      modelId:"WNBA-FBIS-v2",modelVersion:"v2",
      home:84,away:79,margin:5,total:163,pHomeWin:.67,sigmaMargin:10.2,sigmaTotal:12.1,
      decomposition:{
        leagueOrtg:102,pace:79,hfa:2.1,
        home:{games:12,ortg:106,drtg:99,matchupOrtg:105},
        away:{games:12,ortg:101,drtg:104,matchupOrtg:100},
      },
    },
  };
  const p=decomposeWnbaProjection(game);
  assert.equal(p.independent,true);
  assert.equal(p.marketInformed,false);
  assert.equal(p.featureCoverage.possessions,"ACTIVE");
  assert.equal(p.featureCoverage.availability,"ACTIVE");
  assert.equal(p.featureCoverage.shotProfile,"NOT_IN_PRODUCTION");
  assert.ok(p.factors.some(x=>x.name==="availability_context"));
});

test("decision engine emits BET/PASS from EV and evidence, with no stake before staking validation",()=>{
  const d=decisionFromOffer({
    offer:{market:"TOTAL",side:"OVER",line:160,price:-110,sportsbook:"Heritage"},
    distribution:{margin:4,total:166,sigmaMargin:10,sigmaTotal:10,pHomeWin:.64},
    intelligence:{marketConfirmation:"CONFIRMS"},
    evidence:{matchupReliability:.9,dataQuality:.9,historicalFactorReliability:.8,priceQuality:1,uncertaintyQuality:.8},
    minEv:.03,
  });
  assert.equal(d.decision,"BET");
  assert.equal(d.stakeUnits,null);
  assert.equal(d.stakeState,"NO_STAKE_RULES");
  assert.equal(d.confidenceCalibrationState,"PROVISIONAL");
});

test("full WNBA game decision evaluates all offers without needing ACTION history",async()=>{
  const game={
    id:"g1",sport:"wnba",start:"2026-07-01T23:00:00Z",
    home:{abbr:"LVA"},away:{abbr:"NYL"},
    odds:{
      heritageListed:true,spread:-3,total:161,
      heritageSpreadHomePrice:-110,heritageSpreadAwayPrice:-110,
      heritageOverPrice:-110,heritageUnderPrice:-110,
      heritageHomeMl:-150,heritageAwayMl:130,
    },
    wnbaV2:{
      modelId:"WNBA-FBIS-v2",modelVersion:"v2",
      home:85,away:78,margin:7,total:163,pHomeWin:.72,sigmaMargin:10.2,sigmaTotal:12.1,
      decomposition:{
        leagueOrtg:102,pace:79,hfa:2.1,
        home:{games:14,ortg:107,drtg:99,matchupOrtg:105},
        away:{games:14,ortg:101,drtg:104,matchupOrtg:100},
      },
    },
  };
  const packet=await buildWnbaGameDecisions(game,null,{minEv:.03});
  assert.equal(packet.ok,true);
  assert.equal(packet.offers.length,6);
  assert.equal(packet.model.marketInformed,false);
  assert.ok(packet.offers.every(x=>x.marketIntelligence.available===false));
});
