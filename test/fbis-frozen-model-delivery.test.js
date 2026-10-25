import test from 'node:test';
import assert from 'node:assert/strict';
import {mapIndexedFrozenForecasts,loadIndexedFrozenForecasts,frozenForecastDateIndex} from '../functions/lib/fbisFrozenModelDelivery.js';
const now=Date.parse('2026-10-25T18:00:00Z'),start='2026-10-26T00:00:00Z';
const sport='nba',date='2026-10-25',game={id:'401909860',sport,start,home_abbr:'DAL',away_abbr:'SA'};
const athlete={sport,player_id:'123',player_name:'Roster Verified',team_key:'SAS'};
const observation={schemaVersion:1,sport,canonicalEventId:game.id,eventStart:start,frozenAt:'2026-10-25T17:00:00Z',
 recordedWager:false,forecasts:[{canonicalPlayerId:'nba:espn:123',market:'points',period:'full_game',
 projection:23.7,sigma:4.2,modelId:'NBA-V1',modelVersion:'v1',modelAsOf:'2026-10-25T16:00:00Z'}]};
test('valid pregame frozen forecast joins only exact event/player/team',()=>{
 const rows=mapIndexedFrozenForecasts([observation],{sport,games:[game],players:[athlete],now});
 assert.equal(rows.length,1);assert.equal(rows[0].fbis_projection,23.7);
 assert.equal(rows[0].canonicalPlayerId,'nba:espn:123');assert.equal(rows[0].opponent,'DAL');
 assert.equal(rows[0].canAuthorizeWager,false);
});
test('post-tip freeze, wrong roster, poststart data, or post-tip current time fail closed',()=>{
 assert.equal(mapIndexedFrozenForecasts([{...observation,frozenAt:start}],{sport,games:[game],players:[athlete],now}).length,0);
 assert.equal(mapIndexedFrozenForecasts([observation],{sport,games:[game],players:[{...athlete,team_key:'NYK'}],now}).length,0);
 assert.equal(mapIndexedFrozenForecasts([observation],{sport,games:[game],players:[athlete],now:Date.parse(start)+1}).length,0);
 assert.equal(mapIndexedFrozenForecasts([{...observation,forecasts:[{...observation.forecasts[0],modelAsOf:start}]}],{sport,games:[game],players:[athlete],now}).length,0);
});
test('indexed blob must match its source SHA-256 before being shown',async()=>{
 const raw=JSON.stringify(observation);const bytes=new TextEncoder().encode(raw);
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const key='player-props/forecasts/v1/nba/'+game.id+'/2026-10-25T17:00:00Z-'+hash+'.json';
 const index={sport,date,receipts:[{ok:true,event:game.id,key}]};
 const files=new Map([[key,raw],[frozenForecastDateIndex(sport,date),JSON.stringify(index)]]);
 const env={ARCHIVE:{get:async k=>files.has(k)?{
 text:async()=>files.get(k),json:async()=>JSON.parse(files.get(k))}:null}};
 const good=await loadIndexedFrozenForecasts(env,{sport,date,games:[game],players:[athlete],now});
 assert.equal(good.status,'SOURCE_HASH_VERIFIED');assert.equal(good.rows.length,1);
 files.set(key,raw.replace('23.7','29.7'));
 const bad=await loadIndexedFrozenForecasts(env,{sport,date,games:[game],players:[athlete],now});
 assert.equal(bad.rows.length,0);assert.equal(bad.status,'PARTIAL_HASH_OR_READ_FAILURE');
});
