import test from 'node:test';
import assert from 'node:assert/strict';
import { captureKalshiPlayerProps } from '../functions/lib/kalshiPlayerPropCollector.js';

function archive() {
 const objects = new Map();
 return {
  objects,
  async get(key){return objects.has(key)?{json:async()=>JSON.parse(objects.get(key))}:null;},
  async put(key,value){objects.set(key,String(value));},
  async delete(key){objects.delete(key);}
 };
}
const ROOT='player-props/kalshi/v1/';
const series='KXNFLPASSYDS';

test('Kalshi resumes source-native cursor without falsely publishing truncated series',async()=>{
 const store=archive();
 store.objects.set('kalshi/public-shadow/v1/series-catalog.json',JSON.stringify({
  ok:true,records:[{ticker:series}]
 }));
 const env={ARCHIVE:store};
 const requests=[];
 const transport=async url=>{
  const p=new URL(url);
  requests.push(p);
  assert.equal(p.searchParams.get('mve_filter'),'exclude');
  assert.equal(p.searchParams.get('series_ticker'),series);
  if(p.searchParams.get('cursor')==='next'){
    return Response.json({markets:[{ticker:series+'-SECOND'}],cursor:''});
  }
  if(!p.searchParams.get('cursor')){
    return Response.json({markets:[{ticker:series+'-FIRST'}],cursor:'next'});
  }
  throw Error('UNKNOWN_CURSOR');
 };
 const start=new Date('2026-10-25T12:00:00Z');
 const first=await captureKalshiPlayerProps(env,{now:start,signedProxy:transport,maxSeries:1,maxPages:1});
 assert.equal(first.incompleteSeries,1);
 assert.equal(first.completeSeries,0);
 assert.equal(first.receipts[0].status,'PARTIAL');
 assert.equal(store.objects.has(ROOT+series+'.json'),false);
 assert.equal(JSON.parse(store.objects.get(ROOT+'progress/'+series+'.json')).cursor,'next');
 const second=await captureKalshiPlayerProps(env,{
  now:new Date(start.getTime()+15*60000),signedProxy:transport,maxSeries:1,maxPages:1
 });
 assert.equal(second.completeSeries,1);
 assert.equal(second.incompleteSeries,0);
 assert.equal(second.records,2);
 assert.equal(requests.length,2);
 assert.equal(requests[1].searchParams.get('cursor'),'next');
 const saved=JSON.parse(store.objects.get(ROOT+series+'.json'));
 assert.equal(saved.paginationComplete,true);
 assert.equal(saved.records.length,2);
 assert.equal(saved.capturedAt,start.toISOString());
 assert.equal(saved.completedAt,new Date(start.getTime()+15*60000).toISOString());
 assert.equal(store.objects.has(ROOT+'progress/'+series+'.json'),false);
});

test('Kalshi rate-limit preserves incomplete cursor without replacing complete snapshot',async()=>{
 const store=archive();
 store.objects.set('kalshi/public-shadow/v1/series-catalog.json',JSON.stringify({ok:true,records:[{ticker:series}]}));
 store.objects.set(ROOT+series+'.json',JSON.stringify({version:1,paginationComplete:true,records:[{ticker:'SAVED'}],capturedAt:'2026-10-25T01:00:00Z'}));
 const env={ARCHIVE:store};
 const at=new Date('2026-10-25T12:00:00Z');
 const first=await captureKalshiPlayerProps(env,{now:at,maxSeries:1,maxPages:1,
  signedProxy:async()=>Response.json({markets:[{ticker:series+'-FIRST'}],cursor:'next'})
 });
 assert.equal(first.receipts[0].status,'PARTIAL');
 const second=await captureKalshiPlayerProps(env,{now:new Date(at.getTime()+15*60000),maxSeries:1,maxPages:1,
  signedProxy:async()=>new Response('',{status:429})
 });
 assert.equal(second.receipts[0].status,'RATE_LIMITED');
 assert.equal(JSON.parse(store.objects.get(ROOT+series+'.json')).records[0].ticker,'SAVED');
 assert.equal(JSON.parse(store.objects.get(ROOT+'progress/'+series+'.json')).cursor,'next');
});
