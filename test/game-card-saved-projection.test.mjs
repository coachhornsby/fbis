import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Card from './src/components/board/RecoveryMiniGameCard.jsx';export const render=(game,clock)=>renderToStaticMarkup(React.createElement(Card,{game,clock}));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},jsx:'automatic'});
// Resolve external React imports relative to this repository.
const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
const dir=await mkdtemp(new URL('../.card-test-',import.meta.url));
let render;
try{await writeFile(dir+'/render.mjs',compiled.outputFiles[0].text);({render}=await import(dir+'/render.mjs'));}finally{await rm(dir,{recursive:true,force:true});}
const clock=Date.parse('2026-11-08T22:00:00Z');
const game={id:'123',sport:'nba',start:'2026-11-08T20:00:00Z',status:'final',away:{name:'Away',score:99},home:{name:'Home',score:105},recoveryHistoricalProjection:{awayScore:110,homeScore:112,expired:true,attribution:'Frozen research',modelId:'NBA-FBIS-v1',generatedAt:'2026-11-08T18:00:00Z',sourceCapturedAt:'2026-11-08T17:00:00Z'}};
test('rendered live/final card shows observed score and saved projected score together',()=>{
 for(const status of ['live','final']){
  const html=render({...game,status},clock);
  assert.ok(html.includes(status==='live'?'LIVE SCORE':'FINAL SCORE'));
  assert.match(html,/99<b>–<\/b>105/);
  assert.ok(html.includes('FBIS PREGAME PROJECTED'));assert.ok(html.includes('110 – 112'));
  assert.ok(html.includes('Snapshot expired'));assert.ok(html.includes('NBA-FBIS-v1'));
 }
});
test('missing saved forecasts and missing actual scores remain explicitly unavailable',()=>{
 const html=render({...game,away:{name:'Away'},home:{name:'Home'},recoveryHistoricalProjection:null},clock);
 assert.ok(html.includes('No verified pregame projection available'));assert.ok(html.includes('PROJECTION UNAVAILABLE'));
 assert.ok(!html.includes('110 – 112'));
});
test('rendered exchange quote label has relative age but no absolute date',()=>{
 const html=render({...game,exchangeReferenceQuotes:[{venue:'Kalshi',marketFamily:'moneyline',side:'away',ask:.52,transport:'REST',receivedAt:new Date(clock-40000).toISOString(),eventStart:game.start}]},clock);
 assert.ok(html.includes('Fetched 40s ago'));
 assert.ok(!html.includes('Fetched Nov'));assert.ok(!html.includes('Reference only'));assert.ok(!html.includes('reference only'));
});
