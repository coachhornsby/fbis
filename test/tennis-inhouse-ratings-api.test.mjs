import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTennisInhouseRatings,onRequestGet} from '../functions/api/tennis-inhouse-ratings.js';
function db(rows){
 return {prepare(sql){return {bind(...args){return {
  first:async()=>({n:rows.length}),all:async()=>({results:rows.slice(0,args.at(-1))})
 }}}}};
}
test('research endpoint fails closed without authentication or D1',async()=>{
 const request=new Request('https://test.invalid/api/tennis-inhouse-ratings');
 assert.equal((await onRequestGet({request,env:{HARVEST_SECRET:'secret'}})).status,403);
});
test('bounded official history does not silently truncate data',async()=>{
 const fake=db([{match_id:'m'}]);
 await assert.rejects(buildTennisInhouseRatings(fake,{maxRows:0}),/RATING_HISTORY_EXCEEDS_BOUNDED_READ/);
});
test('empty official history produces no synthetic player ratings',async()=>{
 const state=await buildTennisInhouseRatings(db([]));
 assert.equal(state.accepted,0);
 assert.equal(state.ratings.length,0);
 assert.equal(state.coverageComplete,true);
 assert.equal(state.canAuthorizeWager,false);
});
