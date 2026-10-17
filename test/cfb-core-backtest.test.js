import test from "node:test";
import assert from "node:assert/strict";
import {evaluateCoreWalkForward} from "../functions/lib/cfbCoreBacktest.js";
import {projectCfbCoreShadow} from "../functions/lib/cfbCoreChallenger.js";

function row(season,i){
  const kickoff=`${season}-10-17T19:30:00Z`;
  const asOf=`${season}-10-12T12:00:00Z`;
  const h=7+(i%13),a=5+((i*7)%17);
  const hd=-2-((i*3)%11),ad=-1-((i*5)%9);
  const margin=3+0.6*((h-ad)-(a-hd));
  const total=50+0.45*((h-ad)+(a-hd));
  return {
    gameId:`${season}-game-${i}`,season,week:7,kickoff,
    finalAt:`${season}-10-18T19:30:00Z`,finalVerified:true,
    baselineHome:27,baselineAway:24,
    home:{coreYear:season,coreThroughWeek:6,coreOffense:h,coreDefense:hd,
      coreWeekBounded:true,coreThroughSeasonType:"regular",
      coreSourceEndpoint:"/ratings/core",coreSourceAsOf:asOf},
    away:{coreYear:season,coreThroughWeek:6,coreOffense:a,coreDefense:ad,
      coreWeekBounded:true,coreThroughSeasonType:"regular",
      coreSourceEndpoint:"/ratings/core",coreSourceAsOf:asOf},
    actualHome:(total+margin)/2,actualAway:(total-margin)/2,
  };
}
test("rolling-origin CORE ablation compares older-year train against newer-year test",()=>{
  const rows=[2022,2023,2024].flatMap(year=>Array.from({length:70},(_,i)=>row(year,i)));
  const report=evaluateCoreWalkForward(rows,{minTrain:50,minTest:50,minFolds:2});
  assert.equal(report.eligibleRows,210);
  assert.equal(report.folds.length,2);
  assert.deepEqual(report.folds.map(x=>x.testSeason),[2023,2024]);
  assert.ok(report.folds.every(x=>x.trainSeasons.every(y=>y<x.testSeason)));
  assert.ok(report.comparison.margin.delta<0);
  assert.ok(report.comparison.total.delta<0);
  assert.equal(report.verifiedOos,true);
  assert.ok(report.artifact?.verifiedOos);
  assert.equal(report.artifact.lastTrainingSeason,2024);
  assert.equal(report.canAuthorizeWager,false);
  const prospect=projectCfbCoreShadow(row(2025,1),report.artifact);
  assert.equal(prospect.ok,true);
  assert.equal(prospect.canInfluenceProduction,false);
});
test("an incomplete one-season real-world sample never passes a multi-season gate",()=>{
  const rows=Array.from({length:80},(_,i)=>row(2026,i));
  const report=evaluateCoreWalkForward(rows);
  assert.equal(report.verifiedOos,false);
  assert.equal(report.artifact,null);
  assert.equal(report.decision,"INSUFFICIENT_OR_NO_INCREMENTAL_OOS_EDGE");
});
test("postgame, duplicate, future-source, and undated game rows excluded",()=>{
  const valid=row(2024,1);
  const bad=[
    {...valid,gameId:"bad-future",home:{...valid.home,coreSourceAsOf:"2024-10-19T00:00:00Z"}},
    {...valid,gameId:"bad-final",finalVerified:false},
    {...valid,gameId:"bad-before-final",finalAt:"2024-10-10T00:00:00Z"},
    {...valid,gameId:"bad-core-undated",home:{...valid.home,coreThroughWeek:null}},
    valid,
  ];
  const report=evaluateCoreWalkForward([valid,...bad]);
  assert.equal(report.eligibleRows,1);
  assert.ok(report.excluded.finalOrDuplicate>=3);
  assert.equal(report.verifiedOos,false);
});
