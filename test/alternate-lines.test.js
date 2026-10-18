import test from 'node:test';import assert from 'node:assert/strict';
import {rankAlternateLines,selectCompetitiveAlternatives} from '../src/lib/alternateLines.js';
const game={sport:'nfl',start:'2026-10-18T17:00:00Z',nflGameMatchup:{final:{sigmaMargin:13.8,sigmaTotal:12.8}},
 pinnoddsResearch:{offers:[{marketFamily:'spread',side:'home',line:-6.5},{marketFamily:'total',side:'over',line:47.5}]}};
const projection={home:28,away:21,total:49};
const quote=(line,decimalOdds,extra={})=>({source:'PinnOdds',marketFamily:'spread',period:'full_game',side:'home',sourceMarketId:'spread-'+line,line,decimalOdds,...extra});
test('buying a safer alternate line can reduce profit expectation despite a higher win rate',()=>{
 const x=rankAlternateLines(game,projection,[quote(-3.5,1.91),quote(10.5,1.05)],{now:new Date('2026-10-18T12:00:00Z')});
 const safe=x.find(x=>x.line===10.5),normal=x.find(x=>x.line===-3.5);
 assert.ok(safe.winProbability>normal.winProbability);assert.ok(safe.estimatedRoi<normal.estimatedRoi);
 assert.equal(safe.state,'VERIFY');assert.equal(safe.canQualify,false);
});
test('missing model scores and uncertainty never invent a line probability',()=>{
 const x=rankAlternateLines(game,{},[quote(-3.5,1.91)]);assert.equal(x[0].winProbability,null);assert.equal(x[0].estimatedRoi,null);
});
test('integer sportsbook lines reserve probability for pushes; other periods and unknown sides are excluded',()=>{
 const x=rankAlternateLines(game,projection,[quote(-3,1.91),{...quote(-1,2),period:'first_half'},{...quote(1,2),side:'unknown'}]);
 assert.equal(x.length,1);assert.ok(x[0].pushProbability>0);
});
test('competitive alternate selector drops longshot juice and keeps the next best hittable prices',()=>{
 const ranked=rankAlternateLines(game,projection,[
  quote(-3.5,1.91),
  quote(-1.5,1.80),
  quote(10.5,1.05),
  {source:'PinnOdds',marketFamily:'total',period:'full_game',side:'over',sourceMarketId:'tot-69',line:69.5,decimalOdds:40},
  {source:'PinnOdds',marketFamily:'total',period:'full_game',side:'over',sourceMarketId:'tot-48',line:48.5,decimalOdds:1.95},
  {source:'PinnOdds',marketFamily:'total',period:'full_game',side:'under',sourceMarketId:'tot-u46',line:46.5,decimalOdds:1.91},
 ],{now:new Date('2026-10-18T12:00:00Z')});
 const top=selectCompetitiveAlternatives(ranked,{limit:3});
 assert.ok(top.length>=1&&top.length<=3);
 assert.ok(top.every(r=>r.isAlternative));
 assert.ok(top.every(r=>r.winProbability>=0.28&&r.winProbability<=0.78));
 assert.ok(top.every(r=>Math.abs(r.american)<=275));
 assert.ok(!top.some(r=>r.line===69.5||r.line===10.5));
});
