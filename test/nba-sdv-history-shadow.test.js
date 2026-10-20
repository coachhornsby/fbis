import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySdvNbaHistorySnapshot,storeSdvNbaHistoryShadow,readSdvNbaShadowStatus}
 from '../functions/lib/nbaSdvHistoryShadow.js';
const build=()=>({
 version:1,source:'SDV_ESPN_NBA_PLAYER_BOXSCORES',mode:'SHADOW_RESEARCH_ONLY',
 seasonType:'NBA_REGULAR_SEASON_ONLY',generatedAt:'2026-10-20T12:00:00.000Z',
 asOfDayExclusive:'2026-10-20',
 provenance:'https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/espn_nba_player_boxscores',
 canQualify:false,canAuthorizeWager:false,playerCount:1,
 entries:[{espnPlayerId:'4684742',games:[{
  gameId:'401898843',date:'2026-04-10',season:2026,seasonType:2,
  minutes:34.5,points:15,rebounds:8,assists:3,three_pointers_made:1
 }]}],
});
test('SDV shadow accepts only regular-season pre-cutoff ESPN ID game logs',()=>{
 const payload=build();
 assert.deepEqual(verifySdvNbaHistorySnapshot(payload),{ok:true,players:1,gameLogs:1,asOfDay:'2026-10-20'});
 for(const [mod,label] of [
  [{...payload,source:'GAMMA'},'source'],
  [{...payload,canAuthorizeWager:true},'wager'],
  [{...payload,playerCount:2},'count'],
  [{...payload,entries:[{...payload.entries[0],espnPlayerId:'ausar'}]},'identity'],
  [{...payload,entries:[{...payload.entries[0],games:[{...payload.entries[0].games[0],date:'2026-10-20'}]}]},'future'],
  [{...payload,entries:[{...payload.entries[0],games:[{...payload.entries[0].games[0],points:101}]}]},'stat'],
  [{...payload,entries:[{...payload.entries[0],games:[{...payload.entries[0].games[0],seasonType:1}]}]},'preseason'],
 ]){
  assert.equal(verifySdvNbaHistorySnapshot(mod).ok,false,label);
 }
});
test('SDV research snapshot is filtered to canonical roster, never wager-authorized, aggregate status only',async()=>{
 const payload=build(),records=new Map();
 payload.entries.push({...payload.entries[0],espnPlayerId:'9999999'});payload.playerCount=2;
 const env={
  DB:{prepare(sql){assert.match(sql,/nba_player_state_profiles/);return{bind(){return{all:async()=>({results:[{player_id:'4684742'}]})}}}}},
  ARCHIVE:{put:async(k,v)=>records.set(k,JSON.parse(v)),get:async k=>records.has(k)?{json:async()=>records.get(k)}:null},
 };
 const out=await storeSdvNbaHistoryShadow(env,payload,{now:new Date('2026-10-20T12:01:00Z')});
 assert.equal(out.ok,true);assert.equal(out.players,1);assert.equal(out.gameLogs,1);
 assert.equal(out.unmatchedExcluded,1);assert.equal(out.canAuthorizeWager,false);
 const status=await readSdvNbaShadowStatus(env);
 assert.equal(status.players,1);
 assert.equal(status.status,'SHADOW_RESEARCH_ONLY');
 assert.equal(JSON.stringify(status).includes('4684742'),false);
 assert.equal((await storeSdvNbaHistoryShadow(env,payload,{now:new Date('2026-10-21T12:00:00Z')})).ok,false);
});
