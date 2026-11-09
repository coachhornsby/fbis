import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const dir=await mkdtemp(resolve('.exchange-render-'));
after(()=>rm(dir,{recursive:true,force:true}));
await build({entryPoints:['src/components/board/RecoveryMiniGameCard.jsx'],outfile:dir+'/card.mjs',bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},jsx:'automatic'});
const Card=(await import(pathToFileURL(dir+'/card.mjs').href)).default;
const now=Date.parse('2026-11-06T16:00:00Z'),start='2026-11-07T01:00:00Z';
const base={id:'presentation-fixture',sport:'cbb',start,status:'scheduled',away:{name:'Away Team'},home:{name:'Home Team'}};
const q=(family,side,line,venue='Kalshi')=>({venue,marketFamily:family,side,line,ask:.52,transport:'WebSocket',receivedAt:new Date(now-1000).toISOString(),eventStart:start});
const render=quotes=>renderToStaticMarkup(React.createElement(Card,{game:{...base,exchangeReferenceQuotes:quotes},clock:now}));
test('empty comparison shows all three source names and explicit unavailable messages',()=>{const s=render([]);assert.equal((s.match(/No captured prices/g)||[]).length,3);assert.ok(s.includes('Kalshi'));assert.ok(s.includes('Polymarket'));assert.ok(s.includes('Team market comparison'));assert.ok(!s.includes('current matched prices'));});
test('current offers retain all families, signed lines and team-total sides',()=>{const s=render([q('moneyline','away',null),q('spread','home',3.5),q('total','over',147.5),q('team_total','away_under',70.5)]);for(const x of ['>ML</th>','Team market comparison','Spread','Total','Team totals','52.0¢','+3.5','O 147.5','U 70.5','Away Team','Home Team'])assert.ok(s.includes(x),x);assert.equal((s.match(/No captured prices/g)||[]).length,2);});
test('stale matched quotes retain relative age and timestamp provenance while wrong-event quotes stay absent',()=>{
 const s=render([{...q('moneyline','away',null),receivedAt:new Date(now-121000).toISOString()},{...q('moneyline','home',null,'Polymarket'),ask:.63,eventStart:'2026-11-08T01:00:00Z'}]);
 assert.equal((s.match(/No captured prices/g)||[]).length,2);
 assert.ok(s.includes('52.0¢'));assert.ok(!s.includes('63.0¢'));
 assert.ok(s.includes('Stale'));assert.match(s,/Fetched 2m ago/);
 assert.ok(s.includes('Provider quote time unknown'));
 assert.ok(s.includes('Team market comparison'));
 assert.ok(!s.includes('reference only'));assert.ok(!s.includes('Reference only'));
 assert.ok(!s.includes('current matched prices'));assert.ok(!s.includes('BEST PRICE'));
});
test('closed and invalid contract states show unavailable, without old prices or links',()=>{
 for(const marketStatus of ['closed','invalid']){
  const s=render([{...q('moneyline','away',null),marketStatus,
   marketId:'KXNCAAMBGAME-26NOV06DUKEUNC-DUKE',eventTicker:'KXNCAAMBGAME-26NOV06DUKEUNC'}]);
  assert.ok(s.includes('Unavailable'));assert.ok(s.includes(marketStatus==='closed'?'Market closed':'Quote unavailable'));
  assert.ok(!s.includes('52.0¢'));assert.ok(!s.includes('href="https://kalshi.com/'));
 }
});
test('retained lines link only to supported exact venue destinations',()=>{
 const kalshi={...q('moneyline','away',null),receivedAt:new Date(now-3600000).toISOString(),
  marketId:'KXNCAAMBGAME-26NOV06DUKEUNC-DUKE',eventTicker:'KXNCAAMBGAME-26NOV06DUKEUNC'};
 const poly={...q('spread','home',3.5,'Polymarket'),marketId:'source-contract-1',marketUrl:'https://polymarket.us/markets/source-contract-1'};
 const s=render([kalshi,poly]);
 assert.ok(s.includes('href="https://kalshi.com/markets/kxncaambgame/mens-college-basketball-mens-game/kxncaambgame-26nov06dukeunc?op_market_ticker=KXNCAAMBGAME-26NOV06DUKEUNC-DUKE"'));
 assert.ok(s.includes('href="https://polymarket.us/markets/source-contract-1"'));assert.ok(s.includes('rel="noopener noreferrer"'));
 assert.ok(s.includes('Stale'));
 const bad=render([{...poly,marketUrl:'https://evil.invalid/markets/source-contract-1'}]);
 assert.ok(bad.includes('52.0¢'));assert.ok(!bad.includes('href="https://evil.invalid'));
 const mismatched=render([{...poly,marketUrl:'https://polymarket.us/markets/another-contract'}]);
 assert.ok(mismatched.includes('href="https://polymarket.us/"'));
 assert.ok(mismatched.includes('Open Polymarket US homepage (game link unavailable)'));
 assert.ok(!mismatched.includes('/markets/another-contract'));
});
test('watermark does not intercept input and prices remain above it',async()=>{const s=await readFile('src/components/board/recoveryMiniGameCard.css','utf8');assert.match(s,/pointer-events:none/);assert.match(s,/isolation:isolate/);assert.match(s,/opacity:\.18/);assert.match(s,/z-index:-1/);assert.match(s,/border-top:1px solid #ffffff25/);});
