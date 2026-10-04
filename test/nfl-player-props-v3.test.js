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
  assert.equal(row.source,"NFLVERSE_LAST5_65_SEASON20_PRIOR15_NGS_MARKET_CALIBRATED_DEFENSE_V3_1");
  assert.equal(row.featureEvidence.opponentMatchup,true);
  assert.equal(row.featureEvidence.positionDefense,true);
  assert.equal(row.featureEvidence.recent5,true);
  assert.equal(row.opponentMatchup.positionDefenseStrength,0);\n  assert.equal(row.opponentMatchup.positionDefenseFactor,1);
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


test("NFL v3.1 uses validated position-defense strength for QB passing yards", () => {
  const feed={
    byTeam:{KC:[{
      id:"qb1",name:"QB One",position:"QB",games:5,passing_yards:250,attempts:34,completions:22,carries:3,rushing_yards:14,
      recent5:{games:5,passing_yards:255,attempts:35,completions:23,carries:3,rushing_yards:15},
      recentGames:[{season:2026,week:4},{season:2026,week:3},{season:2026,week:2},{season:2026,week:1}],
      snapShare:.99,trackingGames:4,snapGames:4,ngs:{cpoe:2,avgTimeToThrow:2.7},
      sd:{passing_yards:55,attempts:5,completions:4,rushing_yards:10,carries:2}
    }],LV:[]},
    leaguePositionDefense:{QB:{passing_yards:230,attempts:33,completions:21,rushing_yards:16,carries:4}}
  };
  const game={id:"qbg",sport:"nfl",home:{abbr:"KC"},away:{abbr:"LV"},researchProjection:{home:24,away:20},
    nflFeatures:{home:{},away:{passEpaAllowed:0,rushEpaAllowed:0,pressureRate:.30,positionDefense:{QB:{passing_yards:276,attempts:36,completions:24,rushing_yards:16,carries:4}}}}};
  const [g]=attachNflPlayerProjectionResearch([game],feed);
  const row=g.playerProjectionRows.find(r=>r.playerName==="QB One"&&r.market==="passing_yards");
  assert.ok(row);
  assert.equal(row.opponentMatchup.positionDefenseStrength,0.65);
  assert.ok(row.opponentMatchup.positionDefenseFactor>1);
});


test("NFL historical calibration caps weak market-role-direction combinations", () => {
  const wr1ReceptionsLess = selectivePropStars({
    sport:"nfl",market:"receptions",targetRole:"WR1",
    fbisProjection:4.0,line:6.5,fbisSigma:1.5,
    roleConfidence:.92,propGate:"CLEAR",eligibleForCard:true,
    featureEvidence:evidence("WR1")
  });
  const te1RecYardsMore = selectivePropStars({
    sport:"nfl",market:"receiving_yards",targetRole:"TE1",
    fbisProjection:64,line:39.5,fbisSigma:12,
    roleConfidence:.90,propGate:"CLEAR",eligibleForCard:true,
    featureEvidence:evidence("TE1")
  });
  assert.equal(wr1ReceptionsLess,1);
  assert.equal(te1RecYardsMore,1);
});

test("NFL historical calibration allows strongest validated five-star segments", () => {
  const wr2RecLess = selectivePropStars({
    sport:"nfl",market:"receptions",targetRole:"WR2",
    fbisProjection:3.2,line:5.5,fbisSigma:1.4,
    roleConfidence:.90,propGate:"CLEAR",eligibleForCard:true,
    featureEvidence:evidence("WR2")
  });
  const qbCompLess = selectivePropStars({
    sport:"nfl",market:"completions",targetRole:"QB1",
    fbisProjection:18.0,line:23.5,fbisSigma:7.0,
    roleConfidence:.92,propGate:"CLEAR",eligibleForCard:true,
    featureEvidence:evidence("QB1")
  });
  assert.equal(wr2RecLess,5);
  assert.equal(qbCompLess,5);
});

test("NFL market calibration requires edge floor before high-star authorization", () => {
  const lowZ = selectivePropStars({
    sport:"nfl",market:"passing_yards",targetRole:"QB1",
    fbisProjection:238,line:250.5,fbisSigma:40,
    roleConfidence:.92,propGate:"CLEAR",eligibleForCard:true,
    featureEvidence:evidence("QB1")
  });
  const highZ = selectivePropStars({
    sport:"nfl",market:"passing_yards",targetRole:"QB1",
    fbisProjection:220,line:250.5,fbisSigma:40,
    roleConfidence:.92,propGate:"CLEAR",eligibleForCard:true,
    featureEvidence:evidence("QB1")
  });
  assert.ok(lowZ <= 2);
  assert.ok(highZ <= 4);
});

test("NFL ranker blocks historically weak one-star segments from published card", () => {
  const out=rankSelectiveProps([
    {sport:"nfl",market:"receptions",targetRole:"WR1",eventId:"g1",playerName:"WR One",
      fbisProjection:3,line:6.5,fbisSigma:1.2,roleConfidence:.9,dataQuality:.9,
      propGate:"CLEAR",eligibleForCard:true,featureEvidence:evidence("WR1")},
    {sport:"nfl",market:"receptions",targetRole:"WR2",eventId:"g2",playerName:"WR Two",
      fbisProjection:3,line:5.5,fbisSigma:1.2,roleConfidence:.9,dataQuality:.9,
      propGate:"CLEAR",eligibleForCard:true,featureEvidence:evidence("WR2")},
  ],{minStars:3,minHitProbability:.50});
  assert.deepEqual(out.rows.map(r=>r.playerName),["WR Two"]);
});
