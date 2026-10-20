import test from "node:test";
import assert from "node:assert/strict";
import { projectNbaGame, estimatePossessions, calibrateNbaProjection, NBA_CALIBRATION } from "../functions/lib/nbaModel.js";
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

test("NBA fit is applied once to original raw game features, not twice to calibrated output",()=>{
  const base=projectNbaGame({id:"regression-opening-night"},{
    homeHistory:hist(110,111),awayHistory:hist(111,110)
  });
  assert.equal(base.ok,true);
  const fit={id:"frozen-NBA-FBIS-v1",version:"research-v1.1-calibrated",
    calibration:{margin: NBA_CALIBRATION.margin,total: NBA_CALIBRATION.total}};
  const one=calibrateNbaProjection(base,fit);
  // The base engine has already used exactly these coefficients.
  assert.ok(Math.abs(one.margin-base.margin)<=0.1,JSON.stringify({one:one.margin,base:base.margin}));
  assert.ok(Math.abs(one.total-base.total)<=0.1,JSON.stringify({one:one.total,base:base.total}));
  // Repeating the same fit must not compound the calibration.
  const twice=calibrateNbaProjection(one,fit);
  assert.equal(twice.margin,one.margin);
  assert.equal(twice.total,one.total);
  assert.equal(one.calibration.inputKind,"raw_pregame_features");
});
test("Boston-Detroit October 20 pregame provenance cannot flip near-even raw game to Boston by seven through duplicate calibration",()=>{
  const base={ok:true,margin:-2.1,total:219.3,rawMargin:0.1,rawTotal:223.3,
    sigmaMargin:14.5,sigmaTotal:18.5,marketInformed:false};
  const fit={version:"research-v1.1-calibrated",
    calibration:{margin:NBA_CALIBRATION.margin,total:NBA_CALIBRATION.total}};
  const result=calibrateNbaProjection(base,fit);
  assert.ok(Math.abs(result.margin-(-2.15))<0.1);
  assert.ok(Math.abs(result.total-219.35)<0.1);
  assert.ok(Math.abs(result.margin-(-6.7))>4);
  assert.equal(result.marketInformed,false);
  const defaultFit=calibrateNbaProjection(base,{});
  assert.equal(defaultFit.margin,base.margin);
  assert.equal(defaultFit.total,base.total);
});
