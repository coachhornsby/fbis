import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFourSportPacket,privateFourSportProjectionFor} from '../functions/lib/privateFourSportProjection.js';
import {captureScoreboards} from '../functions/lib/publicBoardSnapshot.js';
import {onRequestGet} from '../deploy/board/functions/api/private/sports/[sport]/[date].js';

const date='2026-11-04',now=Date.parse('2026-11-04T14:00:00Z');
const source='2026-11-04T13:55:00Z',start='2026-11-04T23:00:00Z';
const fixture={eventId:'401234567',date,start,homeId:'nba-1',awayId:'nba-2',sourceCapturedAt:source,
 projection:{homeScore:110.5,awayScore:108.5,margin:2,total:219,modelId:'FBIS-NBA',modelVersion:'v1'},canAuthorizeWager:false};
const packet={version:1,visibility:'PRIVATE_PERSONAL_ANALYSIS',sport:'nba',date,generatedAt:'2026-11-04T14:00:00Z',expiresAt:'2026-11-04T20:00:00Z',modelAuthority:'FROZEN_RESEARCH',events:[fixture],canAuthorizeWager:false};
const game={id:fixture.eventId,sport:'nba',date,start,home:{espnId:'1',name:'Home'},away:{espnId:'2',name:'Away'},status:'scheduled'};
test('valid frozen NBA packet with exact ESPN identity matches game',()=>{
 const p=validateFourSportPacket(packet,{sport:'nba',date});
 const r=privateFourSportProjectionFor(game,p,now);
 assert.equal(r.projection.homeScore,110.5);assert.equal(r.historical,false);
});
test('expired frozen forecast remains historical and is not current',()=>{
 const x=privateFourSportProjectionFor(game,packet,Date.parse('2026-11-04T22:00:00Z'));
 assert.equal(x.expired,true);assert.equal(x.historical,true);
});
test('wrong date / identity / start never projects on the wrong card',()=>{
 assert.equal(privateFourSportProjectionFor({...game,id:'99'},packet,now),null);
 assert.equal(privateFourSportProjectionFor({...game,home:{espnId:'3'}},packet,now),null);
 assert.equal(privateFourSportProjectionFor({...game,start:'2026-11-04T23:30:00Z'},packet,now),null);
});
test('numeric scores, margin and total must reconcile',()=>{
 for(const change of [{homeScore:111.9},{margin:5},{total:230},{homeScore:null}]){
  const e={...fixture,projection:{...fixture.projection,...change}};
  assert.throws(()=>validateFourSportPacket({...packet,events:[e]}));
 }
});
test('reject duplicate event, cross date and wager authorization',()=>{
 assert.throws(()=>validateFourSportPacket({...packet,events:[fixture,fixture]}));
 assert.throws(()=>validateFourSportPacket({...packet,events:[{...fixture,date:'2026-11-03'}]}));
 assert.throws(()=>validateFourSportPacket({...packet,canAuthorizeWager:true}));
});
test('reject missing source receipt or post-tip capture',()=>{
 assert.throws(()=>validateFourSportPacket({...packet,events:[{...fixture,sourceCapturedAt:null}]}));
 assert.throws(()=>validateFourSportPacket({...packet,events:[{...fixture,sourceCapturedAt:'2026-11-05T23:00:00Z'}]}));
});
test('private endpoint fails closed for unverified user before any R2 read',async()=>{
 let reads=0;const env={FBIS_PRIVATE_CBB:{get:async()=>{reads++;return null;}}};
 const res=await onRequestGet({request:new Request('https://fbis-myz.pages.dev/api/private/sports/nba/'+date),env,params:{sport:'nba',date}});
 assert.equal(res.status,401);assert.equal((await res.json()).state,'PRIVATE_AUTH_REQUIRED');assert.equal(reads,0);
});
test('private endpoint rejects forbidden sport and invalid date',async()=>{
 const req=new Request('https://fbis-myz.pages.dev/api/private/sports/mlb/'+date);
 assert.equal((await onRequestGet({request:req,params:{sport:'mlb',date},env:{}})).status,400);
 assert.equal((await onRequestGet({request:req,params:{sport:'nba',date:'2026-11-99'},env:{}})).status,400);
});
test('four-sport polling makes eight bounded ESPN calls, never tennis NHL MLB',async()=>{
 const calls=[];
 const fetchFn=async url=>{
   calls.push(url);
   return new Response(JSON.stringify({events:[]}),{status:200,headers:{'content-type':'application/json'}});
 };
 const result=await captureScoreboards({date,now,fetchFn,sports:['cbb','nfl','nba','cfb']});
 assert.equal(calls.length,8);assert.deepEqual(Object.keys(result.feeds).sort(),['cbb','cfb','nba','nfl']);
 assert.equal(result.sources.length,8);
 assert.equal(calls.some(url=>/tennis|hockey|baseball/.test(url)),false);
});
test('scoreboard refuses unexpected sport scope',async()=>{
 await assert.rejects(captureScoreboards({date,now,sports:['cbb','soccer']}),/INVALID_SPORT_SCOPE/);
});
