import test from 'node:test';
import assert from 'node:assert/strict';
import {captureScoreboards} from '../functions/lib/publicBoardSnapshot.js';
test('four-sport recovery uses FBS for football and DI for basketball without extra requests', async()=>{
 const urls=[];
 const board=await captureScoreboards({date:'2026-11-07',sports:['cbb','nfl','nba','cfb'],fetchFn:async url=>{
  urls.push(new URL(url));return Response.json({events:[]});
 }});
 assert.equal(urls.length,8);
 for(const u of urls){
  assert.equal(u.origin,'https://site.api.espn.com');
  assert.equal(u.searchParams.get('limit'),'500');
  assert.ok(['20261107','20261108'].includes(u.searchParams.get('dates')));
  assert.equal(u.searchParams.get('groups'),u.pathname.includes('college-football')?'80':u.pathname.includes('mens-college-basketball')?'50':null);
 }
 assert.equal(board.canAuthorizeWager,false);
 assert.equal(board.costContract.publicD1Queries,0);
});
test('full board request count remains sixteen with no authority expansion',async()=>{
 let calls=0;
 const board=await captureScoreboards({date:'2026-11-07',fetchFn:async()=>{calls++;return Response.json({events:[]});}});
 assert.equal(calls,16);assert.equal(board.canQualify,false);assert.equal(board.canAuthorizeWager,false);
});
