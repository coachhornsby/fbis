import test from "node:test";
import assert from "node:assert/strict";
import {
  CFB_CORE_SHADOW_ID,CFB_CORE_FEATURE_KEYS,
  buildCfbCoreMatchupVector,projectCfbCoreShadow,
} from "../functions/lib/cfbCoreChallenger.js";

const kickoff="2026-10-17T19:30:00Z";
const row=(offense,defense,rest={})=>({
  coreYear:2026,coreThroughWeek:6,coreOffense:offense,coreDefense:defense,
  coreWeekBounded:true,coreThroughSeasonType:"regular",
  coreSourceEndpoint:"/ratings/core",
  coreSourceAsOf:"2026-10-12T15:00:00Z",...rest,
});
const game=(overrides={})=>({
  season:2026,week:7,kickoff,baselineHome:27,baselineAway:24,
  home:row(12,-4),away:row(9,-2),...overrides,
});
const model=(intercept=0)=>({
  intercept,beta:[0,0,0.45,0.2],means:[0,50,0,0],stds:[10,8,4,7],
});
const fitted=()=>({
  modelId:CFB_CORE_SHADOW_ID,authority:"research_only",
  verifiedOos:true,lastTrainingSeason:2025,
  features:[...CFB_CORE_FEATURE_KEYS],margin:model(),total:model(51),
  artifactId:"research-only-offline",
});
test("cross-match CORE vector preserves units and baseline; no market data",()=>{
  const input=buildCfbCoreMatchupVector(game({pinnOdds:-120}));
  assert.equal(input.ok,true);
  assert.equal(input.features.coreCrossMargin,(12-(-2))-(9-(-4)));
  assert.equal(input.features.coreCrossTotal,(12-(-2))+(9-(-4)));
  assert.equal(input.features.baselineMargin,3);
  assert.equal(input.lineage.pointInTime,true);
  assert.equal(input.canAuthorizeWager,false);
  assert.equal(input.features.pinnOdds,undefined);
});
test("unverified, future or week-zero CORE never creates predictions",()=>{
  const cases=[
    game({home:row(12,-4,{coreThroughWeek:7})}),
    game({home:row(12,-4,{coreThroughWeek:null})}),
    game({home:row(12,-4,{coreOffense:null})}),
    game({home:row(12,-4,{coreYear:2025})}),
    game({home:row(12,-4,{coreWeekBounded:false})}),
    game({away:row(9,-2,{coreSourceAsOf:"2026-10-17T21:00:00Z"})}),
    game({away:row(9,-2,{coreSourceEndpoint:"/ratings/sp"})}),
    game({away:row(9,-2,{coreThroughSeasonType:"postseason"})}),
    game({away:row(9,-2,{coreThroughWeek:5})}),
    game({baselineHome:null}),
  ];
  for(const g of cases){
    const r=projectCfbCoreShadow(g,fitted());
    assert.equal(r.ok,false,JSON.stringify(g));
    assert.equal(r.canAuthorizeWager,false);
  }
});
test("requires a verified earlier-season artifact; no fake default weights",()=>{
  for(const art of [null,{}, {...fitted(),verifiedOos:false},
    {...fitted(),lastTrainingSeason:2026},
    {...fitted(),features:["bad"]},
    {...fitted(),margin:{...model(),beta:[1]}},
  ]){
    assert.equal(projectCfbCoreShadow(game(),art).ok,false);
  }
  const noArtifact=projectCfbCoreShadow(game());
  assert.equal(noArtifact.reason,"FITTED_RESEARCH_ARTIFACT_NOT_VERIFIED");
  assert.ok(noArtifact.diagnostics.vector.ok);
});
test("OOS-fitted artifact produces research-only, market-blind score decomposition",()=>{
  const a=projectCfbCoreShadow(game({market:{spread:-28}}),fitted());
  const b=projectCfbCoreShadow(game({market:{spread:24}}),fitted());
  assert.equal(a.ok,true);
  assert.equal(b.ok,true);
  assert.equal(a.margin,b.margin);
  assert.equal(a.total,b.total);
  assert.ok(a.home>0&&a.away>0);
  assert.ok(Math.abs(a.home+a.away-a.total)<1e-9);
  assert.ok(Math.abs(a.home-a.away-a.margin)<1e-9);
  assert.equal(a.canInfluenceProduction,false);
  assert.equal(a.canQualify,false);
  assert.equal(a.canAuthorizeWager,false);
  assert.equal(a.pHomeWin,null);
});

test("existing CFB matchup attachment emits a separate pending CORE shadow without moving the champion", async()=>{
  const {attachCfbMatchupV2}=await import("../functions/lib/cfbMatchupV2.js");
  const before={
    sport:"cfb",id:"event-123",season:2026,week:7,start:kickoff,
    projectionKind:"FBIS",model:{projHome:27,projAway:24,projectionKind:"FBIS"},
    cfbDeepInput:{home:row(12,-4),away:row(9,-2)},
  };
  const result=attachCfbMatchupV2([before]);
  const after=result.games[0];
  assert.deepEqual(after.model,before.model);
  assert.equal(after.cfbCoreShadow.reason,"FITTED_RESEARCH_ARTIFACT_NOT_VERIFIED");
  assert.equal(after.challengers[CFB_CORE_SHADOW_ID].canAuthorizeWager,false);
  assert.equal(after.cfbCoreShadow.ok,false);
  const projected=attachCfbMatchupV2([before],{coreArtifact:fitted()}).games[0];
  assert.equal(projected.cfbCoreShadow.ok,true);
  assert.equal(projected.cfbCoreShadow.canInfluenceProduction,false);
  assert.deepEqual(projected.model,before.model);
  assert.equal(projected.cfbMatchupV2.margin,after.cfbMatchupV2.margin);
});
