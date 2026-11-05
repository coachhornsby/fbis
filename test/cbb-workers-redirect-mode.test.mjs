import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedScoreboardFetch} from '../functions/lib/publicBoardSnapshot.js';
import {fetchSource,readRecentCbbScheduleAsset} from '../functions/lib/cbbPrivateOperatorRefresh.js';

const espn='https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=20261105';
const now=Date.parse('2026-11-05T14:20:00Z');
test('Workers ESPN scoreboard fetch uses supported manual redirect mode and decodes valid source',async()=>{
 let calls=0;
 const body=await boundedScoreboardFetch(espn,{fetchFn:async(url,init)=>{
  calls++;assert.equal(url,espn);assert.equal(init.redirect,'manual');
  return Response.json({events:[]});
 }});
 assert.equal(calls,1);assert.deepEqual(body,{events:[]});
});
test('Workers ESPN fetch fails closed on 3xx without requesting redirected destination',async()=>{
 let calls=0;
 await assert.rejects(boundedScoreboardFetch(espn,{fetchFn:async(url,init)=>{
  calls++;assert.equal(init.redirect,'manual');
  return new Response(null,{status:302,headers:{Location:'https://untrusted.example/out'}});
 }}),/ESPN_REDIRECT_BLOCKED/);
 assert.equal(calls,1);
});
test('licensed KenPom request never follows redirect with Authorization header',async()=>{
 let calls=0;
 await assert.rejects(fetchSource('https://kenpom.com/api.php?endpoint=ratings&y=2027','kenpom',{
  key:'private-test-key',cap:1024,fetchFn:async(url,init)=>{
   calls++;assert.equal(new URL(url).hostname,'kenpom.com');
   assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,'Bearer private-test-key');
   return new Response(null,{status:301,headers:{Location:'https://untrusted.example/capture'}});
  }
 }),/KENPOM_REDIRECT_BLOCKED/);
 assert.equal(calls,1);
});
test('Torvik optional comparison fetch also rejects redirects without following them',async()=>{
 let calls=0;
 await assert.rejects(fetchSource('https://barttorvik.com/2027_team_results.csv','torvik',{
  cap:1024,fetchFn:async(url,init)=>{
   calls++;assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,undefined);
   return new Response(null,{status:307,headers:{Location:'https://untrusted.example/csv'}});
  }
 }),/TORVIK_REDIRECT_BLOCKED/);
 assert.equal(calls,1);
});
test('Cloudflare ASSETS Request uses supported manual redirect mode',async()=>{
 let calls=0;
 const r=await readRecentCbbScheduleAsset('2026-11-05',{now,assets:{fetch:async(req)=>{
  calls++;assert.equal(req.redirect,'manual');assert.match(req.url,/\/board-data\/2026-11-05\.json$/);
  return new Response(null,{status:302,headers:{Location:'https://untrusted.example/asset'}});
 }}});
 assert.equal(r,null);assert.equal(calls,1);
});
test('provider allowlist rejects off-host URL before any request or credential transmission',async()=>{
 let calls=0;
 await assert.rejects(fetchSource('https://example.com/ratings','kenpom',{
  key:'private-test-key',cap:100,fetchFn:async()=>{calls++;return Response.json([]);}
 }),/SOURCE_NOT_ALLOWED/);
 assert.equal(calls,0);
});
