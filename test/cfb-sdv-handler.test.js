import test from 'node:test';import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/slate.js';import {resetCacheMem} from '../functions/lib/cache.js';
test('CFBD 429 cannot erase a verified public weekly slate; model/wager gates remain closed',async()=>{
 const oldFetch=globalThis.fetch,oldCaches=globalThis.caches;resetCacheMem();let cfbdCalls=0;
 globalThis.caches={default:{async match(){return null},async put(){}}};
 const event={id:'401999999',date:'2026-10-17T19:00:00Z',season:{year:2026},week:{number:8},competitions:[{status:{type:{name:'STATUS_SCHEDULED',state:'pre',completed:false}},competitors:[{homeAway:'home',team:{id:'333',displayName:'Alabama'}},{homeAway:'away',team:{id:'61',displayName:'Georgia'}}]}]};
 globalThis.fetch=async url=>{
  const u=String(url);
  if(u.includes('collegefootballdata.com')){cfbdCalls++;return Response.json({message:'Quota exhausted'},{status:429,headers:{'Retry-After':'3600'}});}
  if(u.includes('/scoreboard'))return Response.json({events:[event]});
  if(u.includes('/rankings'))return Response.json({rankings:[]});
  if(u.includes('/roster'))return Response.json({athletes:[]});
  if(u.includes('kalshi.com'))return Response.json({markets:[]});
  return Response.json({}, {status:503});
 };
 try{
  const res=await onRequestGet({request:new Request('https://fixture.invalid/api/slate?sport=cfb&date=2026-10-11'),env:{CFBD_API_KEY:'fixture-only'}});
  const body=await res.json();assert.equal(res.status,200);assert.equal(body.games.length,1);assert.equal(body.games[0].id,event.id);
  assert.equal(body.week.range.since,'2026-10-11');assert.equal(cfbdCalls,1,"First 429 must stop subsequent provider fanout");
  assert.notEqual(body.games[0].canAuthorizeWager,true);assert.notEqual(body.games[0].cfb?.bettingAllowed,true);
 }finally{globalThis.fetch=oldFetch;globalThis.caches=oldCaches;resetCacheMem();}
});
