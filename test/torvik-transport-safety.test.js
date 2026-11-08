import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTorvikCbbCatalog} from '../functions/lib/torvikCbb.js';
import {resetCacheMem} from '../functions/lib/cache.js';
const csv='Team,Conf,G,AdjOE,AdjDE,Barthag,Adj T.,WAB\nHouston,B12,3,121.4,88.6,0.96,65.8,6.1';
for(const [label,response] of [
 ['403',()=>new Response('Forbidden',{status:403})],
 ['redirect',()=>new Response('',{status:302,headers:{location:'https://barttorvik.com/'}})],
 ['HTML',()=>new Response('<html>challenge</html>',{headers:{'content-type':'text/html'}})],
 ['disguised HTML',()=>new Response('<!DOCTYPE html><html>',{headers:{'content-type':'text/csv'}})],
 ['network failure',()=>{throw Error('network')}],
]) test(`fails closed on ${label} without fallback or second file`,async()=>{
 resetCacheMem(); let calls=0;
 const result=await loadTorvikCbbCatalog({}, {cbbSeason:2026,fetchFn:async(url,options)=>{
 calls++; assert.equal(url,'https://barttorvik.com/2027_team_results.csv');assert.equal(options.redirect,'manual');return response();}});
 assert.equal(result.ok,false); assert.equal(calls,1);
});
test('accepts ratings, keeps absent four factors unavailable and uses ending year',async()=>{
 resetCacheMem();const urls=[];
 const result=await loadTorvikCbbCatalog({}, {cbbSeason:2026,fetchFn:async(url)=>{urls.push(url);return url.includes('team_results')?new Response(csv,{headers:{'content-type':'text/csv'}}):new Response('blocked',{status:403});}});
 assert.equal(result.ok,true);assert.equal(result.fourFactorAvailable,false);assert.equal(urls.length,2);assert.ok(urls.every(u=>u.startsWith('https://barttorvik.com/2027_')));
});
test('rejects unexpected final URL',async()=>{
 resetCacheMem();let calls=0;
 const result=await loadTorvikCbbCatalog({}, {cbbSeason:2026,fetchFn:async()=>{calls++;return {ok:true,status:200,url:'https://barttorvik.com/',headers:new Headers({'content-type':'text/csv'}),text:async()=>csv};}});
 assert.equal(result.ok,false);assert.equal(calls,1);
});
