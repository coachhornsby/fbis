import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {parseNhlOfficialPlayerStat,captureNhlOfficialPlayerResults} from '../functions/lib/nhlOfficialPlayerResults.js';
const scope={identityVerified:true,canonicalEventId:'evt1',canonicalPlayerId:'nhl:nhl:8478402',gameId:'2025020001',playerId:'8478402',stat:'shots_on_goal',period:'full_game'};
const box={id:2025020001,gameState:'OFF',gameScheduleState:'OK',playerByGameStats:{homeTeam:{forwards:[{playerId:8478402,sog:0}],defense:[],goalies:[]},awayTeam:{forwards:[],defense:[],goalies:[]}}};
test('exact final NHL player result preserves true zero',()=>{const r=parseNhlOfficialPlayerStat(box,scope,'2026-10-20T22:00:00Z');assert.equal(r.ok,true);assert.equal(r.result.actual,0);});
test('unknown players, nonfinal box scores and unverified identity are blocked',()=>{
 for(const b of [{...box,gameState:'LIVE'},{...box,id:2},{...box,playerByGameStats:{}}])assert.equal(parseNhlOfficialPlayerStat(b,scope,'2026-10-20T22:00:00Z').ok,false);
 assert.equal(parseNhlOfficialPlayerStat(box,{...scope,identityVerified:false},'2026-10-20T22:00:00Z').ok,false);
});
test('only pre-certified R2 scopes can enter official result storage',async()=>{
 const memory=new Map();const env={ARCHIVE:{get:async k=>memory.has(k)?{json:async()=>JSON.parse(memory.get(k)),text:async()=>memory.get(k)}:null,put:async(k,v)=>memory.set(k,v)}};
 assert.equal((await captureNhlOfficialPlayerResults(env,{webCrypto:webcrypto})).ok,false);
 memory.set('player-props/official/v1/nhl-scopes.json',JSON.stringify({version:1,certified:true,scopes:[scope]}));
 const r=await captureNhlOfficialPlayerResults(env,{now:new Date('2026-10-20T22:00:00Z'),webCrypto:webcrypto,fetchImpl:async()=>({ok:true,json:async()=>box})});
 assert.equal(r.ok,true);assert.equal(r.stored,1);assert.equal(r.canAuthorizeWager,false);
 assert.ok([...memory.keys()].some(k=>k.includes('/official_result/')));
});
