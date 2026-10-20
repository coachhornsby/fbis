import test from 'node:test';import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/slate.js';import {resetCacheMem} from '../functions/lib/cache.js';import {todayCT,shiftDateCT} from '../functions/lib/slateEngineCore.js';
test('Unauthorized CFBD acquisition cannot erase an SDV weekly slate or open wager gates',async()=>{
 const oldFetch=globalThis.fetch,oldCaches=globalThis.caches;resetCacheMem();let cfbdCalls=0;
 const day=todayCT(); // Keep the API date within its current seven-day lookback, including after October 18.
 globalThis.caches={default:{async match(){return null},async put(){}}};
 const event={id:'401999999',date:shiftDateCT(day,6)+'T19:00:00Z',season:{year:Number(day.slice(0,4))},week:{number:8},competitions:[{status:{type:{name:'STATUS_SCHEDULED',state:'pre',completed:false}},competitors:[{homeAway:'home',team:{id:'333',displayName:'Alabama'}},{homeAway:'away',team:{id:'61',displayName:'Georgia'}}]}]};
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
  const res=await onRequestGet({request:new Request('https://fixture.invalid/api/slate?sport=cfb&date='+day),env:{CFBD_API_KEY:'fixture-only'}});
  const body=await res.json();assert.equal(res.status,200);assert.equal(body.games.length,1);assert.equal(body.games[0].id,event.id);
  assert.equal(body.week.range.since,day);assert.equal(cfbdCalls,0,"Public weekly SDV slate must not contact CFBD");
  assert.notEqual(body.games[0].canAuthorizeWager,true);assert.notEqual(body.games[0].cfb?.bettingAllowed,true);
 }finally{globalThis.fetch=oldFetch;globalThis.caches=oldCaches;resetCacheMem();}
});
