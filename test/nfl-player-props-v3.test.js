import test from "node:test";
import assert from "node:assert/strict";
import { attachNflPlayerProjectionResearch } from "../functions/lib/proPlayerProjectionLayer.js";
import { rankSelectiveProps } from "../functions/lib/selectivePropEdge.js";

test("NFL player projections use opponent matchup without using PrizePicks line", () => {
  const feed={byTeam:{
    KC:[{
      id:"wr1",name:"WR One",position:"WR",games:6,receiving_yards:72,receptions:5.4,targets:8.5,
      snapShare:.90,trackingGames:5,snapGames:6,
      ngs:{avgSeparation:3.5,yacOverExpected:1.1},
      sd:{receiving_yards:24,receptions:1.7}
    }],
    LV:[]
  }};
  const base={
    id:"nfl-prop",sport:"nfl",home:{abbr:"KC"},away:{abbr:"LV"},
    researchProjection:{home:28,away:20},
    nflFeatures:{
      home:{},
      away:{passEpaAllowed:.18,rushEpaAllowed:.05,pressureRate:.22}
    }
  };
  const [g]=attachNflPlayerProjectionResearch([base],feed);
  const row=g.playerProjectionRows.find(r=>r.playerName==="WR One"&&r.market==="receiving_yards");
  assert.ok(row);
  assert.equal(row.marketInformed,false);
  assert.equal(row.source,"NFLVERSE_WEEKLY_PLUS_NGS_SNAP_MATCHUP_V3");
  assert.equal(row.featureEvidence.opponentMatchup,true);
  assert.ok(row.matchupFactor>1);
  assert.equal(row.line,undefined);
});

test("selective NFL prop portfolio rejects weak role even with a large raw gap", () => {
  const out=rankSelectiveProps([
    {sport:"nfl",eventId:"g1",playerName:"Strong",fbisProjection:88,line:70.5,fbisSigma:18,roleConfidence:.9,dataQuality:.9,propGate:"CLEAR",eligibleForCard:true,featureEvidence:{nextGen:true,snapShare:true,opponentMatchup:true}},
    {sport:"nfl",eventId:"g2",playerName:"Weak Role",fbisProjection:95,line:70.5,fbisSigma:18,roleConfidence:.35,dataQuality:.9,propGate:"CLEAR",eligibleForCard:true,featureEvidence:{nextGen:true,snapShare:true,opponentMatchup:true}},
  ],{minStars:2,minHitProbability:.55});
  assert.deepEqual(out.rows.map(r=>r.playerName),["Strong"]);
});
