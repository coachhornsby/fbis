import test from "node:test";
import assert from "node:assert/strict";
import {
  qualifyNhlPITHistoricalRow,fitNhlResearchLogistic,evaluateNhlUnifiedWalkforward,
  NHL_UNIFIED_RESEARCH_CANDIDATES
} from "../functions/lib/nhlUnifiedMoneylineResearch.js";

function historical(season,index){
  const seasonYear=Number(season.slice(0,4));
  const start=new Date(Date.UTC(seasonYear,10,1+index,23)).toISOString();
  const frozen=new Date(Date.parse(start)-60*60*1000).toISOString();
  const cutoff=new Date(Date.parse(start)-2*60*60*1000).toISOString();
  const p=.30+(index%11)*.035,q=.33+(index%9)*.04,g=.31+(index%7)*.05;
  const outcome=Number(((index*37+seasonYear*3)%101)<(p*.5+q*.3+g*.2)*100);
  return {eventId:season+"-"+index,season,gameStart:start,featureCutoffTimestamp:cutoff,
    frozenAt:frozen,snapshotId:"frozen-"+season+"-"+index,immutableSnapshot:true,
    sourcePITVerified:true,home:"BOS",away:"NYR",
    marketScope:"FULL_GAME_INCLUDING_OT_SHOOTOUT",marketInformed:false,
    modelVersions:{proV2:"p",winV1:"w",goalieShadow:"g"},
    components:{incumbent:p,win:q,goalie:g,score:p*.8+.1},outcomeHomeWin:outcome,
    goalieStatus:index%2?"CONFIRMED_BOTH":"PROJECTED"};
}
test("rejects missing immutable identity and after-start leakage",()=>{
  const r=historical("20212022",1);
  assert.equal(qualifyNhlPITHistoricalRow(r).ok,true);
  assert.ok(qualifyNhlPITHistoricalRow({...r,sourcePITVerified:false}).errors.includes("IMMUTABLE_PIT_SNAPSHOT_REQUIRED"));
  assert.ok(qualifyNhlPITHistoricalRow({...r,featureCutoffTimestamp:r.gameStart}).errors.includes("FEATURE_OR_FROZEN_CUTOFF_INVALID")===false);
  assert.ok(qualifyNhlPITHistoricalRow({...r,frozenAt:r.gameStart}).errors.includes("FEATURE_OR_FROZEN_CUTOFF_INVALID"));
  assert.ok(qualifyNhlPITHistoricalRow({...r,marketInformed:true}).errors.includes("MARKET_SCOPE_OR_PREDICTION_INDEPENDENCE_INVALID"));
});
test("ridge fit uses training rows and all combinations including full three-head",()=>{
  const rows=Array.from({length:100},(_,i)=>historical("20212022",i));
  assert.equal(Object.keys(NHL_UNIFIED_RESEARCH_CANDIDATES).length,9);
  const fitted=fitNhlResearchLogistic(rows,["incumbent","win","goalie"]);
  assert.equal(fitted.length,4);
  assert.ok(fitted.every(Number.isFinite));
});
test("walkforward uses chronological nonoverlapping train/validation/test seasons",()=>{
  const seasons=["20212022","20222023","20232024","20242025"];
  const rows=seasons.flatMap(season=>Array.from({length:220},(_,i)=>historical(season,i)));
  const opts={trainSeasons:seasons.slice(0,2),validationSeasons:seasons.slice(2,3),testSeasons:seasons.slice(3)};
  const x=evaluateNhlUnifiedWalkforward(rows,opts);
  assert.equal(x.status,"UNQUALIFIED_SHADOW_RESEARCH");
  assert.equal(x.split.testN,220);
  assert.equal(x.test.allThree.metrics.n,220);
  assert.equal(x.test.incumbent.metrics.n,220);
  assert.ok(Number.isFinite(x.test.allThree.metrics.brier));
  assert.equal(x.test.allThree.coefficients.length,4);
  assert.equal(x.promotionEligible,false);
  assert.equal(x.canQualify,false);
  assert.equal(x.canAuthorizeWager,false);
  assert.throws(()=>evaluateNhlUnifiedWalkforward(rows,{...opts,testSeasons:["20232024"]}),/OVERLAPPING_SPLITS/);
  assert.throws(()=>evaluateNhlUnifiedWalkforward(rows.slice(0,30),opts),/SAMPLE_INSUFFICIENT/);
});
