import test from 'node:test';
import assert from 'node:assert/strict';
import {attachVerifiedNflScheduleContext as attach} from '../functions/lib/nflVerifiedScheduleContext.js';
const now=Date.parse('2026-11-09T12:00:00Z');
function fixture(){
 const past=[{id:'a',week:9,home:'BUF',away:'NYJ',start:'2026-11-08T18:00:00Z'},
 {id:'b',week:8,home:'MIN',away:'GB',start:'2026-11-01T18:00:00Z'}];
 const target={id:'c',espnId:'123',week:10,home:'BUF',away:'MIN',start:'2026-11-12T23:00:00Z',neutralSite:false};
 return {game:{id:'123',start:target.start,home:{abbr:'BUF'},away:{abbr:'MIN'},nflFeatures:{home:{offenseEpa:0.2,travelMiles:4000,restDays:99}}},checked:{gameMap:new Map([...past,target].map(g=>[g.id,g])),completed:new Set(['a','b']),expiresAt:now+3600000,scheduleAt:now-3600000}};
}
test('derives short rest and bye separately, preserves model features, does not invent travel',()=>{
 const {game,checked}=fixture(),out=attach(game,checked,now);
 assert.equal(out.nflFeatures.home.restDays,4);
 assert.equal(out.nflFeatures.away.restDays,11);
 assert.equal(out.nflFeatures.home.offenseEpa,0.2);
 assert.equal(out.nflScheduleContext.home.shortWeek,true);
 assert.equal(out.nflScheduleContext.away.comingOffBye,true);
 assert.equal(out.nflScheduleContext.home.comingOffBye,false);
 assert.equal(out.nflFeatures.home.travelMiles,undefined);
 assert.equal(game.nflFeatures.home.travelMiles,4000);
 assert.equal(out.nflScheduleContext.away.travelMiles,null);
});
test('incomplete prior game never asserts rest or bye',()=>{
 const {game,checked}=fixture();checked.completed.delete('a');
 const out=attach(game,checked,now);
 assert.equal(out.nflFeatures.home.restDays,undefined);
 assert.equal(out.nflScheduleContext.home.comingOffBye,null);
});
test('expired, started, mismatched, and raw schedule inputs remain unchanged',()=>{
 const {game,checked}=fixture();
 assert.equal(attach(game,{...checked,expiresAt:now},now),game);
 assert.equal(attach(game,checked,Date.parse(game.start)),game);
 assert.equal(attach(game,{games:[]},now),game);
 const bad={...game,home:{abbr:'NE'}};assert.equal(attach(bad,checked,now),bad);
});
test('DST boundary uses calendar rest, not elapsed 24 hour periods',()=>{
 const {game,checked}=fixture();checked.gameMap.get('a').start='2026-11-01T00:00:00Z';
 checked.gameMap.get('c').start='2026-11-08T01:00:00Z';game.start='2026-11-08T01:00:00Z';
 const earlier=Date.parse('2026-11-02T12:00:00Z');checked.scheduleAt=earlier;checked.expiresAt=earlier+3600000;
 assert.equal(attach(game,checked,earlier).nflFeatures.home.restDays,7);
});
test('verified rest changes existing model score with unchanged coefficients',async()=>{
 const {projectNflProV1}=await import('../functions/lib/nflProModel.js');
 const {game,checked}=fixture();
 game.nflFeatures={home:{offenseEpa:0.1,defenseEpa:0,qbEpa:0.1},away:{offenseEpa:0.1,defenseEpa:0,qbEpa:0.1}};
 const base=projectNflProV1(game),adjusted=projectNflProV1(attach(game,checked,now));
 assert.equal(adjusted.ok,true);
 assert.equal(adjusted.decomposition.home.context,-0.36);
 assert.equal(adjusted.decomposition.away.context,0.48);
 assert.ok(adjusted.home<base.home);assert.ok(adjusted.away>base.away);
 assert.equal(adjusted.canAuthorizeWager,false);
});
