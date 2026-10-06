import test from "node:test";
import assert from "node:assert/strict";
import { buildMlbPersistentPlayerPropRows } from "../functions/lib/mlbPlayerPropModel.js";
import { canonicalizeProPlayerPropMarket } from "../functions/lib/proPlayerProps.js";
import { classifyMlbPropPromotionEvidence, MLB_PROP_PROMOTION_GOVERNANCE } from "../functions/lib/mlbPropPromotionGovernance.js";
import fs from "node:fs";

function sc(role,kRate=.22){
  return {
    role,kRate,
    global:{xwoba:.325,contactPerSwing:.76,whiffPerSwing:.24,hardHitRate:.39,barrelRate:.06,swingRate:.47},
    buckets:{"four_seam|middle_middle":{weight:20,whiffPerSwing:.24,contactPerSwing:.76,xwoba:.325,hardHitRate:.39,barrelRate:.06,velocity:94,spin:2300,pfxX:.1,pfxZ:1.2,extension:6.3}}
  };
}

test("MLB persistent prop engine emits requested pitcher and hitter markets",()=>{
  const game={
    id:"1",sport:"mlb",
    home:{abbr:"HOM"},away:{abbr:"AWY"},
    homeSp:{id:100,name:"Home Starter"},awaySp:{id:200,name:"Away Starter"},
    model:{projHome:4.8,projAway:4.1},
    mlbDeepShadow:{home:4.8,away:4.1,pitcherKs:{home:{projection:6.2,expectedInnings:5.8},away:{projection:5.5,expectedInnings:5.4}}},
    mlbPitchMatchup:{homeOffense:{runFactor:1.04,xwoba:.333,contactPerSwing:.77},awayOffense:{runFactor:.97,xwoba:.308,contactPerSwing:.74}},
    mlbContext:{palParkRunFactor:1.02,palParkHrFactor:1.05,weatherRunFactor:1},
    bpp:{batterMatchups:[]}
  };
  const hitter={id:"300",name:"Home Hitter",position:"RF",status:"Active",games:150,plateAppearances:630,hitPerPa:.24,totalBasesPerPa:.41,homeRunPerPa:.055,walkRate:.10,strikeoutRate:.21,statcastProfile:sc("batter",.21)};
  const state={
    fresh:true,
    homeStarter:{id:100,name:"Home Starter",era:3.2,whip:1.12,h9:7.5,bb9:2.4,bbRate:.065,expectedInnings:5.8,inningsPerStart:5.9,battersFacedPerInning:4.15,statcastProfile:sc("pitcher",.27),recentStarter:{rows:[{innings:6},{innings:5.2},{innings:6.1}]}},
    awayStarter:{id:200,name:"Away Starter",era:4.1,whip:1.31,h9:8.8,bb9:3.1,bbRate:.085,expectedInnings:5.4,inningsPerStart:5.5,battersFacedPerInning:4.3,statcastProfile:sc("pitcher",.23),recentStarter:{rows:[{innings:5},{innings:5.2},{innings:6}]}},
    homeTeam:{lineup:{activeHitters:[{id:"300"}]}},
    awayTeam:{lineup:{activeHitters:[]}},
    teamHitters:{home:{"300":hitter},away:{}},
    hitters:{"300":hitter},
  };
  const rows=buildMlbPersistentPlayerPropRows(game,state);
  const pitcher=new Set(rows.filter(r=>r.position==="P").map(r=>r.market));
  for(const market of ["pitcher_outs","hits_allowed","earned_runs","walks_allowed","pitch_count"])assert.ok(pitcher.has(market),market);
  const batter=new Set(rows.filter(r=>r.playerId==="300").map(r=>r.market));
  for(const market of ["strikeouts","hits","total_bases","home_runs","walks","runs","rbis","hits_runs_rbis"])assert.ok(batter.has(market),market);
  assert.ok(rows.every(r=>r.marketInformed===false));
  assert.ok(rows.every(r=>r.maturity==="RESEARCH_UNVALIDATED"));
  assert.ok(rows.filter(r=>r.position!=="P").every(r=>r.lineupState==="ROSTER_FALLBACK"));
});

test("MLB batter walks canonicalizes independently from pitcher walks allowed",()=>{
  assert.equal(canonicalizeProPlayerPropMarket("mlb","batter_walks"),"walks");
  assert.equal(canonicalizeProPlayerPropMarket("mlb","pitcher_walks"),"walks_allowed");
  assert.equal(canonicalizeProPlayerPropMarket("mlb","pitches_thrown"),"pitch_count");
  assert.equal(canonicalizeProPlayerPropMarket("mlb","h_r_rbi"),"hits_runs_rbis");
});


test("MLB prop promotion gate is explicit and fail-closed during evaluation",()=>{
  assert.equal(MLB_PROP_PROMOTION_GOVERNANCE.autoPromotion,false);
  assert.equal(MLB_PROP_PROMOTION_GOVERNANCE.canQualifyDuringEvaluation,false);
  assert.equal(MLB_PROP_PROMOTION_GOVERNANCE.canAuthorizeWagerDuringEvaluation,false);
  assert.equal(MLB_PROP_PROMOTION_GOVERNANCE.rawProjectionDistanceCanPromote,false);
  assert.equal(classifyMlbPropPromotionEvidence({settledN:0,walkForwardN:0,distinctDates:0}).classification,"INSUFFICIENT_DATA");
});

test("MLB promotion readiness requires strong market-specific prospective evidence",()=>{
  const evidence={
    settledN:1200,walkForwardN:800,distinctDates:60,
    directionalWalkForwardN:{OVER:350,UNDER:350},
    distanceBuckets:[{n:100},{n:100},{n:100},{n:100}],
    edgeHitMonotonic:true,bucketRankCorrelation:.75,
    calibratedBrier:.22,calibratedEce:.03,absoluteBiasSdShare:.06,
    maeImprovementVsBestNonMarketBaseline:.04,
    prospectiveDays:21,temporalIntegrity:true,stateBeforeWeight:true,
    maxMaterialSegmentRelativeMaeDegradation:.06,
  };
  const out=classifyMlbPropPromotionEvidence(evidence);
  assert.equal(out.classification,"PROMOTION_READY");
  assert.equal(out.promotionAllowed,false);
  assert.equal(out.autoPromotion,false);
});

test("MLB rare-event markets may use proper-score improvement instead of MAE",()=>{
  const evidence={
    settledN:600,walkForwardN:350,distinctDates:35,
    directionalWalkForwardN:{OVER:120,UNDER:120},
    distanceBuckets:[{n:50},{n:50},{n:50}],
    edgeHitMonotonic:true,bucketRankCorrelation:.65,
    calibratedBrier:.24,calibratedEce:.05,absoluteBiasSdShare:.10,
    rareEventMarket:true,properScoreImprovementVsBestNonMarketBaseline:.02,
  };
  assert.equal(classifyMlbPropPromotionEvidence(evidence).classification,"CALIBRATION_CANDIDATE");
});

test("PrizePicks persistence retains separate prop model source and version lineage",()=>{
  const api=fs.readFileSync(new URL("../functions/api/prizepicks-props.js",import.meta.url),"utf8");
  const workflow=fs.readFileSync(new URL("../.github/workflows/prizepicks-targeted-props.yml",import.meta.url),"utf8");
  assert.match(api,/raw_json,model_source,model_version/);
  assert.match(api,/s\(cand\?\.modelSource\),s\(cand\?\.modelVersion\)/);
  assert.match(workflow,/modelSource:\(\.source \/\/ null\)/);
  assert.match(workflow,/modelVersion:\(\.modelVersion \/\/ null\)/);
});
