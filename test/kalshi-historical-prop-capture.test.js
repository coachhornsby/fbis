import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadCapturedKalshiProps} from '../functions/lib/kalshiPlayerPropCollector.js';

test('historical event-day archive is selected instead of rolling market snapshot',async()=>{
 const series='KXMLBHIT';
 const contract={ticker:series+'-26OCT232000TBMIL-MILTURANG25-1',
  rules_primary:'If Brice Turang records 1+ hits in the Tampa Bay vs Milwaukee professional baseball game originally scheduled for Oct 23, 2026 at 8:00 PM EDT, then the market resolves to Yes.',
  strike_type:'greater',floor_strike:.5,custom_strike:{baseball_player:'kalshi-turang'}};
 const history={capturedAt:'2026-10-23T20:00:00Z',historical:true,paginationComplete:true,records:[contract]};
 const calls=[];
 const env={ARCHIVE:{get:async key=>{calls.push(key);return key==='player-props/kalshi/v1/history/2026-10-23/KXMLBHIT.json'?{json:async()=>history}:null;}}};
 const games=[{id:'849805',sport:'mlb',start:'2026-10-24T00:00:00Z',home_abbr:'MIL',away_abbr:'TB',home_name:'Milwaukee Brewers',away_name:'Tampa Bay Rays'}];
 const players=[{sport:'mlb',player_id:'668930',player_name:'Brice Turang',team_key:'MIL'}];
 const loaded=await loadCapturedKalshiProps(env,{sport:'mlb',date:'2026-10-23',seriesFilter:series,now:Date.parse('2026-10-24T08:00:00Z'),games,players});
 assert.equal(loaded.coverage[0].historical,true);
 assert.equal(loaded.rows.length,1);
 assert.equal(loaded.rows[0].line,.5);
 assert.equal(loaded.rows[0].canonicalEventId,'849805');
 assert.equal(loaded.rows[0].purchaseAsk,null);
 assert.equal(loaded.rows[0].canAuthorizeWager,false);
 assert.ok(calls.some(k=>k.includes('/history/2026-10-23/')));
});
test('collector archives only pregame observations',()=>{
 const src=fs.readFileSync('functions/lib/kalshiPlayerPropCollector.js','utf8');
 assert.match(src,/now\.getTime\(\)>=kickoff/);
 assert.match(src,/if\(!additions\)continue/);
});
