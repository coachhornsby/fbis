import test from "node:test";
import assert from "node:assert/strict";
import { attachNflPlayerProjectionResearch } from "../functions/lib/proPlayerProjectionLayer.js";
import { rankSelectiveProps, selectivePropStars } from "../functions/lib/selectivePropEdge.js";

function evidence(role="WR1"){
  return {
    nextGen:true,
    snapShare:true,
    opponentMatchup:true,
    positionDefense:true,
    recent5:true,
    targetRole:true,
    targetRoleName:role,
  };
}

test("NFL v3 player projections use target role, last-five baseline and positional opponent defense without market input", () => {
  const feed={
    byTeam:{
      KC:[{
        id:"wr1",name:"WR One",position:"WR",games:4,receiving_yards:72,receptions:5.4,targets:8.5,
        recent5:{games:5,receiving_yards:81,receptions:6.1,targets:9.2},
        recentGames:[{season:2026,week:4},{season:2026,week:3},{season:2026,week:2},{season:2026,week:1},{season:2025,week:18}],
        seasonAvg:{receiving_yards:74},priorAvg:{receiving_yards:63},
        snapShare:.90,trackingGames:4,snapGames:4,
        ngs:{avgSeparation:3.5,yacOverExpected:1.1},
        sd:{receiving_yards:24,receptions:1.7}
      }],
      LV:[]
    },
    leaguePositionDefense:{WR:{receiving_yards:145,receptions:11}}
  };
  const base={
    id:"nfl-prop",sport:"nfl",home:{abbr:"KC"},away:{abbr:"LV"},
    researchProjection:{home:28,away:20},
    nflFeatures:{
      home:{},
      away:{
        passEpaAllowed:.18,rushEpaAllowed:.05,pressureRate:.22,
        positionDefense:{WR:{receiving_yards:174,receptions:13}}
      }
    }
  };
  const [g]=attachNflPlayerProjectionResearch([base],feed);
  const row=g.playerProjectionRows.find(r=>r.playerName==="WR One"&&r.market==="receiving_yards");
  assert.ok(row);
  assert.equal(row.targetRole,"WR1");
  assert.equal(row.marketInformed,false);
  assert.equal(row.source,"NFLVERSE_LAST5_65_SEASON25_PRIOR10_NGS_POSITION_DEFENSE_V3");
  assert.equal(row.featureEvidence.opponentMatchup,true);
  assert.equal(row.featureEvidence.positionDefense,true);
  assert.equal(row.featureEvidence.recent5,true);
  assert.ok(row.opponentMatchup.positionDefenseFactor>1);
  assert.equal(row.line,undefined);
});

test("NFL v3 publishes only QB1 RB1 WR1 WR2 TE1 from each team", () => {
  const mk=(id,name,position,snapShare,targets=0,carries=0,attempts=0)=>({
    id,name,position,snapShare,targets,carries,attempts,games:4,
    receiving_yards:targets*7,rushing_yards:carries*4.2,passing_yards:attempts*7,
    recent5:{games:4,targets,carries,attempts,receiving_yards:targets*7,rushing_yards:carries*4.2,passing_yards:attempts*7},
    recentGames:[{season:2026,week:4},{season:2026,week:3},{season:2026,week:2},{season:2026,week:1}],
    sd:{receiving_yards:12,rushing_yards:15,passing_yards:45},
    ngs:{avgSeparation:3.0},trackingGames:4,snapGames:4
  });
  const feed={byTeam:{KC:[
    mk("qb1","QB1","QB",.99,0,2,34),mk("qb2","QB2","QB",.08,0,1,3),
    mk("rb1","RB1","RB",.68,4,16),mk("rb2","RB2","RB",.35,2,8),
    mk("wr1","WR1","WR",.93,10),mk("wr2","WR2","WR",.86,8),mk("wr3","WR3","WR",.72,6),
    mk("te1","TE1","TE",.84,6),mk("te2","TE2","TE",.41,3)
  ],LV:[]},leaguePositionDefense:{}};
  const game={id:"g",sport:"nfl",home:{abbr:"KC"},away:{abbr:"LV"},researchProjection:{home:24,away:20},nflFeatures:{home:{},away:{}}};
  const [g]=attachNflPlayerProjectionResearch([game],feed);
  const names=new Set(g.playerProjectionRows.map(r=>r.playerName));
  assert.deepEqual([...names].sort(),["QB1","RB1","TE1","WR1","WR2"]);
});

test("selective NFL prop portfolio rejects weak role even with a large raw gap", () => {
  const out=rankSelectiveProps([
    {sport:"nfl",eventId:"g1",playerName:"Strong",fbisProjection:88,line:70.5,fbisSigma:18,roleConfidence:.9,dataQuality:.9,propGate:"CLEAR",eligibleForCard:true,featureEvidence:evidence("WR1")},
    {sport:"nfl",eventId:"g2",playerName:"Weak Role",fbisProjection:95,line:70.5,fbisSigma:18,roleConfidence:.35,dataQuality:.9,propGate:"CLEAR",eligibleForCard:true,featureEvidence:evidence("WR1")},
  ],{minStars:2,minHitProbability:.55});
  assert.deepEqual(out.rows.map(r=>r.playerName),["Strong"]);
});

test("NFL 5-star confidence requires target role, recent-five and complete matchup evidence", () => {
  const strong = selectivePropStars({
    sport:"nfl",fbisProjection:98,line:74.5,fbisSigma:18,
    roleConfidence:.92,propGate:"CLEAR",eligibleForCard:true,
    featureEvidence:evidence("WR1")
  });
  const noRecent = selectivePropStars({
    sport:"nfl",fbisProjection:98,line:74.5,fbisSigma:18,
    roleConfidence:.92,propGate:"CLEAR",eligibleForCard:true,
    featureEvidence:{...evidence("WR1"),recent5:false}
  });
  const nonTarget = selectivePropStars({
    sport:"nfl",fbisProjection:98,line:74.5,fbisSigma:18,
    roleConfidence:.92,propGate:"CLEAR",eligibleForCard:true,
    featureEvidence:{...evidence("WR3"),targetRole:false}
  });
  assert.equal(strong,5);
  assert.ok(noRecent<=2);
  assert.equal(nonTarget,1);
});
