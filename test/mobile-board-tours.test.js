import test from 'node:test';import assert from 'node:assert/strict';
import {tennisClassification,filterTennisTour,boardSportCounts} from '../src/lib/tennisTourView.js';
import {onRequestGet} from '../functions/api/tennis-board-portraits.js';
const g=(id,tour,extra={})=>({id,sport:'tennis',tour,tennisProjection:{},...extra});
test('ATP/WTA filters preserve exact event and market object identities without duplicates',()=>{
 const xs=[g('a','atp'),g('w','WTA'),g('u',null),g('double','atp',{tennisProjection:{tournament:'Men Doubles'}})];
 const atp=filterTennisTour(xs,'atp'),wta=filterTennisTour(xs,'wta');assert.deepEqual(atp,[xs[0]]);assert.deepEqual(wta,[xs[1]]);assert.equal(atp[0],xs[0]);assert.equal(filterTennisTour(xs,'all'),xs);
 assert.deepEqual(boardSportCounts([{games:xs},{games:[xs[0]]}]),{all:4,atp:1,wta:1,tennis:4});
});
test('ITF/Challenger/125/doubles/unknown retain truthful competition levels',()=>{
 assert.equal(tennisClassification(g('a','atp',{tennisProjection:{tournament:'ATP Challenger Guayaquil Men Singles'}})).level,'Challenger');
 assert.equal(tennisClassification(g('a','wta',{tennisProjection:{tournament:'WTA 125'}})).level,'WTA 125');
 assert.equal(tennisClassification(g('a','atp',{tennisProjection:{tournament:'ITF M25'}})).label,'ITF Men');
 assert.equal(tennisClassification(g('a',null)).tour,null);
 assert.equal(tennisClassification(g('a','atp',{tennisProjection:{tour:'wta'}})).tour,null);
 assert.equal(tennisClassification(g('a','atp')).format,'Format unverified');
});
test('portrait bridge rejects unbounded names and unknown tours before database access',async()=>{
 const r=await onRequestGet({request:new Request('https://fbis.test/?tour=nhl&names=%5B%22A%22%5D'),env:{}});assert.equal(r.status,400);
});
test('ambiguous player identity cannot receive an approved portrait',async()=>{
 const db={prepare(sql){return{bind(){return this;},async all(){assert.match(sql,/tennis_players/);return{results:[{fbis_player_id:'one',canonical_name:'Name'},{fbis_player_id:'two',canonical_name:'Name'}]};}};}};
 const r=await onRequestGet({request:new Request('https://fbis.test/?tour=atp&names=%5B%22Name%22%5D'),env:{DB:db}});assert.deepEqual((await r.json()).players,[]);
});
