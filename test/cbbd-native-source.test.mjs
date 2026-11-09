import test from 'node:test';import assert from 'node:assert/strict';
import{buildCurrentCbbNativeEvidence,captureCbbdNativeInputs}from'../scripts/lib/cbbdNativeSource.mjs';
const asOf='2026-11-09T06:00:00Z',start='2026-11-03T23:00:00Z';
const games=[{id:1,season:2027,startDate:start,status:'final'}];
const base={gameId:1,season:2027,startDate:start,possessions:70,fga:60,fgm:30,threeMade:10,threeAtt:25,fta:14,ftm:10,orb:8,drb:22,turnovers:10};
const boxes=[{...base,team:'Duke',opponent:'North Carolina',points:80,isHome:true},{...base,team:'North Carolina',opponent:'Duke',points:70,isHome:false}];
const fixtures=[{eventId:'42',date:'2026-11-09',start:'2026-11-10T00:00:00Z',homeId:'cbb-150',awayId:'cbb-153',neutralSite:false,primary:{total:150}}];
test('actual current completed boxes influence independent comparison without primary authority',()=>{
 const a=buildCurrentCbbNativeEvidence({games,boxes,fixtures,asOf});assert.equal(a.pairedD1Games,1);assert.equal(a.projections.length,1);assert.equal(a.primaryModelInfluence,0);assert.equal(a.projections[0].canAuthorizeWager,false);assert.equal(a.projections[0].lowSample,true);
 const b=buildCurrentCbbNativeEvidence({games,boxes:boxes.map(r=>({...r,points:r.points+10})),fixtures,asOf});assert.notEqual(a.projections[0].total,b.projections[0].total);
});
test('scheduled, wrong-season, future and one-sided evidence cannot forecast',()=>{
 for(const patch of[{status:'scheduled'},{season:2026},{startDate:'2026-11-10T00:00:00Z'}])assert.equal(buildCurrentCbbNativeEvidence({games:[{...games[0],...patch}],boxes,fixtures,asOf}).projections.length,0);
 assert.equal(buildCurrentCbbNativeEvidence({games,boxes:boxes.slice(0,1),fixtures,asOf}).projections.length,0);
});
test('capture uses exactly two bounded current-season endpoints',async()=>{
 let calls=0;const r=await captureCbbdNativeInputs({key:'test',reserve:k=>{assert.equal(k,'CBBD');calls++;},now:()=>Date.parse(asOf),fetchFn:async url=>{assert.match(url,/season=2027/);return Response.json(url.includes('/games/teams')?boxes:games);}});assert.equal(calls,2);assert.equal(r.receipt.requests,2);
});
test('provider-capped response fails closed',()=>{assert.throws(()=>buildCurrentCbbNativeEvidence({games:Array(3000).fill(games[0]),boxes,fixtures,asOf}),/COMPLETENESS/);});
