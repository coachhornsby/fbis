import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryCardFacts} from '../src/lib/recoveryCardFacts.js';
const now=Date.parse('2026-11-06T14:00:00Z');
const game={status:'scheduled',start:'2026-11-07T00:00:00Z',away:{abbr:'AWY',score:null},home:{abbr:'HME',score:null},
 recoveryVerifiedProjection:{awayScore:110.5,homeScore:111.8,margin:1.3,total:222.3,expiresAt:'2026-11-07T07:00:00Z'}};
test('fair spread uses the projected winner and original unrounded model total',()=>{
 const x=recoveryCardFacts(game,now);assert.equal(x.fairSpread,'HME −1.3');assert.equal(x.total,222.3);
 const y=recoveryCardFacts({...game,recoveryVerifiedProjection:{...game.recoveryVerifiedProjection,margin:-1.3}},now);
 assert.equal(y.fairSpread,'AWY −1.3');
});
test('expired, missing or malformed forecasts do not fill model fields',()=>{
 for(const recoveryVerifiedProjection of [null,{...game.recoveryVerifiedProjection,total:null},
 {...game.recoveryVerifiedProjection,expiresAt:'2026-11-06T13:00:00Z'}]){
  const x=recoveryCardFacts({...game,recoveryVerifiedProjection},now);assert.equal(x.fairSpread,null);assert.equal(x.total,null);
 }
});
test('observed live/final scores replace forecasts and pregame placeholder zeros never become results',()=>{
 const x=recoveryCardFacts({...game,status:'final',away:{score:108},home:{score:114}},now);
 assert.equal(x.actual,true);assert.equal(x.awayScore,108);assert.equal(x.fairSpread,null);
 const y=recoveryCardFacts({...game,recoveryVerifiedProjection:null,away:{score:0},home:{score:0}},now);
 assert.equal(y.actual,false);assert.equal(y.awayScore,null);
});
test('saved forecasts and actual scores coexist without treating historical forecasts as fresh',()=>{
 const p={awayScore:110.5,homeScore:111.8,expired:true};
 for(const status of ['live','final']){
  const x=recoveryCardFacts({...game,status,away:{score:108},home:{score:114},recoveryHistoricalProjection:p},now);
  assert.equal(x.actual,true);assert.equal(x.awayScore,108);assert.equal(x.homeScore,114);
  assert.equal(x.savedProjection,p);assert.equal(x.fresh,false);assert.equal(x.fairSpread,null);
 }
 assert.equal(recoveryCardFacts({...game,recoveryHistoricalProjection:p},now).savedProjection,null);
 assert.equal(recoveryCardFacts({...game,status:'final',recoveryHistoricalProjection:{awayScore:null,homeScore:1}},now).savedProjection,null);
});
