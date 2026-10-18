import test from 'node:test';import assert from 'node:assert/strict';
import {rankAlternateLines} from '../src/lib/alternateLines.js';
const game={sport:'nfl',start:'2026-10-18T17:00:00Z',nflGameMatchup:{final:{sigmaMargin:13.8,sigmaTotal:12.8}}};
const projection={home:28,away:21,total:49};
const quote=(line,decimalOdds)=>({source:'PinnOdds',marketFamily:'spread',period:'full_game',side:'home',sourceMarketId:'spread-'+line,line,decimalOdds});
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
