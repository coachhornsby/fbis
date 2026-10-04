import test from "node:test";
import assert from "node:assert/strict";
import { projectNbaGame, estimatePossessions, calibrateNbaProjection } from "../functions/lib/nbaModel.js";
import { projectNbaPlayer, compareNbaProp } from "../functions/lib/nbaPlayerPropModel.js";

const hist=(pf,pa)=>Array.from({length:12},(_,i)=>({date:`2026-01-${String(i+1).padStart(2,"0")}`,pointsFor:pf+i%4,pointsAgainst:pa+i%3,fga:88,orb:10,tov:13,fta:22}));
test("NBA game model is independent and distributional",()=>{
  const p=projectNbaGame({id:"g1"},{homeHistory:hist(118,110),awayHistory:hist(111,115)});
  assert.equal(p.ok,true); assert.equal(p.marketInformed,false); assert.equal(p.canAuthorize,false);
  assert.ok(p.expectedPossessions>90&&p.expectedPossessions<107);
  assert.ok(p.home>p.away); assert.ok(p.pHomeWin>0.5);
});
test("availability lowers projection and widens uncertainty",()=>{
  const base=projectNbaGame({id:"g1"},{homeHistory:hist(118,110),awayHistory:hist(111,115)});
  const hurt=projectNbaGame({id:"g1"},{homeHistory:hist(118,110),awayHistory:hist(111,115),homeAvailability:[{status:"OUT",impactPoints:4}]});
  assert.ok(hurt.home<base.home); assert.ok(hurt.sigmaMargin>=base.sigmaMargin);
});
test("possession formula works",()=>{assert.ok(Math.abs(estimatePossessions({fga:90,orb:11,tov:14,fta:20})-101.8)<.001);});
test("prop model projects minutes then stats without line input",()=>{
  const h=Array.from({length:10},(_,i)=>({date:`2026-02-${String(i+1).padStart(2,"0")}`,minutes:34,points:24+i%5,rebounds:7,assists:6,threes:2.5,starter:1}));
  const p=projectNbaPlayer({id:"1",name:"Test Player"},{history:h,teamProjection:119,gamePossessions:101});
  assert.equal(p.ok,true); assert.equal(p.marketInformed,false); assert.ok(p.minutes>30); assert.ok(p.markets.points.projection>20);
  const a=compareNbaProp(p,"points",24.5),b=compareNbaProp(p,"points",30.5);
  assert.equal(a.fbisProjection,b.fbisProjection); assert.ok(a.probabilityOver>b.probabilityOver); assert.equal(a.decisionEligible,true);
});


test("NBA calibration preserves independence and reconstructs team scores",()=>{
  const raw={ok:true,margin:5,total:225,sigmaMargin:12,sigmaTotal:16,marketInformed:false,canQualify:false,canAuthorize:false};
  const fit={id:"fit",version:"research-v1.1-calibrated",trainingCutoff:"2025-06-22",calibration:{margin:{intercept:-1,slope:1.2,sigma:14},total:{intercept:-20,slope:1.1,sigma:18}}};
  const p=calibrateNbaProjection(raw,fit);
  assert.equal(p.modelVersion,"research-v1.1-calibrated");
  assert.equal(p.marketInformed,false);
  assert.equal(p.margin,5);
  assert.ok(Math.abs(p.total-227.5)<=0.1);
  assert.ok(Math.abs((p.home+p.away)-p.total)<=0.11);
  assert.ok(Math.abs((p.home-p.away)-p.margin)<=0.11);
  assert.equal(p.calibration.marketUsed,false);
});
