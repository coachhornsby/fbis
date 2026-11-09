import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
test('actual public compactRecovery route renders retained Pinnacle quotes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pinnodds-render-'));try{
  const out=join(dir,'render.cjs');
  await build({stdin:{contents:`import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import DecisionBoard from './src/components/board/DecisionBoard.jsx';import{renderPinnoddsReference}from'./src/lib/pinnoddsStaticReference.js';import packet from './data/public/pinnodds/2026-11-09.json';export function render(now){const p=packet.games[0];const game=renderPinnoddsReference({id:p.id,sport:p.sport,start:p.start,status:'scheduled',home:{name:p.home_name,abbr:'OSU'},away:{name:p.away_name,abbr:'MRSH'}},packet,{now});return renderToStaticMarkup(<DecisionBoard games={[game]} compactRecovery clock={now}/>);}`,resolveDir:resolve('.'),loader:'jsx'},outfile:out,bundle:true,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
  const {default:mod}=await import(pathToFileURL(out));const {render}=mod;
  for(const now of [Date.parse('2026-11-09T03:40:00Z'),Date.parse('2026-11-09T04:30:00Z')]){const html=render(now);assert.match(html,/fbis-mini-card/);assert.match(html,/pinnodds-card-reference/);assert.match(html,/Pinnacle/);assert.match(html,/via PinnOdds/);assert.match(html,/-26/);assert.match(html,/162.5/);assert.match(html,/Last fetched/);if(now>Date.parse('2026-11-09T03:53:25Z'))assert.match(html,/Stale/);}
  assert.doesNotMatch(render(Date.parse('2026-11-09T23:00:00Z')),/pinnodds-card-reference/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
