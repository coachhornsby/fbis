import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {boardDate,scoreboardGames,captureScoreboards,boundedScoreboardFetch,PUBLIC_SPORTS} from '../functions/lib/publicBoardSnapshot.js';
const date='2026-11-01',capturedAt='2026-11-01T18:00:00Z';
const fixture=(start='2026-11-02T02:00:00Z')=>({id:'401234567',date:start,status:{type:{state:'pre',detail:'Scheduled'}},competitions:[{id:'401234567',date:start,competitors:[{homeAway:'home',score:'0',team:{id:'1',displayName:'Home'}},{homeAway:'away',score:'0',team:{id:'2',displayName:'Away'}}]}]});
test('Central date boundaries include the next UTC day and DST fallback',()=>{
  assert.equal(boardDate('2026-11-02T05:59:00Z'),'2026-11-01');
  assert.equal(boardDate('2026-11-02T06:00:00Z'),'2026-11-02');
  assert.equal(boardDate('2026-11-01T06:30:00Z'),'2026-11-01');
  const games=scoreboardGames({events:[fixture()]},{sport:'cbb',date,capturedAt});
  assert.equal(games.length,1);assert.equal(games[0].home.score,null);
  assert.equal(games[0].model,null);assert.equal(games[0].canAuthorizeWager,false);
});
test('tennis tournament containers expose only individual singles matches',()=>{
  const c=fixture().competitions[0];c.status=fixture().status;c.competitors=c.competitors.map((r,i)=>({...r,id:String(i+1),team:undefined,athlete:{displayName:i?'Away Player':'Home Player'}}));
  const payload={events:[{groupings:[{grouping:{slug:'mens-singles'},competitions:[c]},{grouping:{slug:'mens-doubles'},competitions:[c]}]}]};
  const games=scoreboardGames(payload,{sport:'tennis',tour:'atp',date,capturedAt});assert.equal(games.length,1);assert.equal(games[0].tour,'atp');assert.equal(games[0].home.espnId,'1');
});
test('unknown teams, malformed payloads, retired sports and truncated feeds fail closed',()=>{
  assert.throws(()=>scoreboardGames({},{sport:'cbb',date,capturedAt}));
  assert.throws(()=>scoreboardGames({events:[]},{sport:'soccer',date,capturedAt}));
  assert.throws(()=>scoreboardGames({events:Array(500).fill(fixture())},{sport:'cbb',date,capturedAt}),/TRUNCATED/);
  const e=fixture();delete e.competitions[0].competitors[0].team.id;
  assert.deepEqual(scoreboardGames({events:[e]},{sport:'cbb',date,capturedAt}),[]);
});
test('capture makes at most sixteen fixed-origin calls, deduplicates and reports failures',async()=>{
  const calls=[];let concurrent=0,max=0;
  const board=await captureScoreboards({date,now:Date.parse(capturedAt),fetchFn:async(url,options)=>{
    calls.push({url,options});concurrent++;max=Math.max(max,concurrent);await Promise.resolve();concurrent--;
    return url.includes('/hockey/')?new Response('',{status:429}):Response.json({events:[fixture()]});
  }});
  assert.equal(calls.length,16);assert.ok(max<=4);
  for(const {url,options} of calls){assert.equal(new URL(url).origin,'https://site.api.espn.com');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');}
  assert.equal(board.feeds.nhl.ok,false);assert.match(board.feeds.nhl.error,/429/);
  assert.equal(board.games.filter(g=>g.sport==='cbb').length,1);
  assert.equal(board.canAuthorizeWager,false);assert.equal(board.costContract.publicD1Queries,0);
  assert.deepEqual(Object.keys(board.feeds),PUBLIC_SPORTS);
});
test('oversized response stops while streaming; arbitrary hosts are rejected before IO',async()=>{
  let canceled=false;
  await assert.rejects(()=>boundedScoreboardFetch('https://site.api.espn.com/apis/site/v2/sports/test',{fetchFn:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(4194305));},cancel(){canceled=true;}}))}),/TOO_LARGE/);
  assert.equal(canceled,true);
  await assert.rejects(()=>boundedScoreboardFetch('https://attacker.invalid/',{fetchFn:()=>{throw Error('SHOULD_NOT_FETCH');}}),/SOURCE_NOT_ALLOWED/);
});
test('isolated release root cannot compile the old Functions tree',()=>{
  assert.equal(existsSync(new URL('../deploy/board/functions',import.meta.url)),false);
  assert.equal(existsSync(new URL('../deploy/board/wrangler.toml',import.meta.url)),false);
  const config=readFileSync(new URL('../vite.publication.config.js',import.meta.url),'utf8');
  assert.match(config,/api-unavailable\.json/);assert.match(config,/deploy\/board\/dist/);
});
