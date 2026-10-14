import test from 'node:test';import assert from 'node:assert/strict';
import {normalizePinnoddsMarkets,pinnoddsSport} from '../functions/lib/pinnoddsMarkets.js';
const event={event_id:123,league_name:'MLB',home:'Home Team',away:'Away Team',starts:'2026-10-14T00:00:00Z',periods:{num_0:{number:0,money_line:{home:1.9,away:2.1},spreads:{'-1.5':{hdp:-1.5,home:2.2,away:1.8},'1.5':{hdp:1.5,home:1.4,away:3.2}},totals:{'7.5':{points:7.5,over:1.9,under:1.95}},team_totals:{home:{'3.5':{points:3.5,over:1.8,under:2.05},'4.5':{points:4.5,over:2.5,under:1.6}}}},num_1:{description:'1st 5 innings',totals:{'4.5':{points:4.5,over:2.1,under:1.8}}}}};
const game={id:'canonical',sport:'mlb',start:event.starts,home_name:'Home Team',away_name:'Away Team'};
const options={sportId:6,feed:'prematch',capturedAt:'2026-10-13T17:00:00Z',snapshotId:'snapshot',rawKey:'raw-key',games:[game]};
test('all periods, alternate spreads, totals and team totals retain exact decimal prices',()=>{
 const result=normalizePinnoddsMarkets({events:[event]},options);assert.equal(result.rows.length,14);assert.equal(result.matchedRows,14);
 assert.equal(result.rows.find(r=>r.marketFamily==='spread'&&r.side==='away'&&r.sourceMarketId.includes('-1.5')).line,1.5);
 assert.equal(result.rows.filter(r=>r.period==='num_1').length,2);assert.equal(result.rows.filter(r=>r.marketFamily==='team_total').length,4);
 assert.ok(result.rows.every(r=>r.sourceObservedAt===null&&r.executionEligible===false&&r.raw.canAuthorizeWager===false));
});
test('all special outcomes retain parent identity and provider labels without canonical player invention',()=>{
 const special={event_id:456,parent_id:123,league_name:'MLB',special:'Pitcher One (Strikeouts)',special_category:'Player Props',special_units:'strikeouts',special_markets:{num_0:[{type:'total',key:'k',prices:[{name:'Over',points:5.5,price:1.8,participant_id:1},{name:'Under',points:5.5,price:2.1,participant_id:2}]}]}};
 const result=normalizePinnoddsMarkets({events:[event,special]},options);const props=result.rows.filter(r=>r.marketFamily==='player_prop');assert.equal(props.length,2);assert.equal(props[0].eventId,'canonical');assert.equal(props[0].playerId,null);assert.equal(props[0].playerName,'Pitcher One');assert.equal(props[0].statFamily,'strikeouts');
 const orphan=normalizePinnoddsMarkets({events:[special]},options);assert.equal(orphan.rows[0].eventId,null);assert.equal(orphan.rows[0].raw.eventMatchStatus,'PARENT_EVENT_UNAVAILABLE');
});
test('unsupported leagues and missing odds remain diagnosed, never zero-priced or relabeled',()=>{
 assert.equal(pinnoddsSport(3,'Euroleague'),null);assert.equal(pinnoddsSport(5,'NCAA Football'),'cfb');assert.equal(pinnoddsSport(6,'Japan NPB'),'npb');
 const result=normalizePinnoddsMarkets({events:[{...event,league_name:'Minor League Baseball'},{...event,periods:{num_0:{money_line:{home:0,away:null}}}}]},options);assert.equal(result.rows.length,0);assert.equal(result.reasons.UNSUPPORTED_LEAGUE,1);assert.equal(result.reasons.UNPRICED_SELECTION,1);
});

test('nested soccer prematch preserves parent prices and every separately identified special',()=>{
 const parent={event_id:900,league_name:'Premier League',home:'Home FC',away:'Away FC',
  starts:'2026-10-15T13:00:00Z',
  periods:{num_0:{number:0,money_line:{home:1.83,away:4.12,draw:3.47}}},
  specials:[{event_id:901,special:'Player One (Goals)',special_category:'Player Props',
    special_units:'goals',special_markets:{num_0:[{type:'total',key:'goals',
      prices:[{name:'Yes',price:2.8,participant_id:3},{name:'No',price:1.43,participant_id:4}]}]}}]};
 const args={sportId:1,feed:'prematch',capturedAt:'2026-10-14T13:00:00Z',
  snapshotId:'nested-soccer',rawKey:'raw-soccer',games:[]};
 const result=normalizePinnoddsMarkets({events:[parent]},args);
 assert.equal(result.inputEvents,2);
 assert.equal(result.rows.filter(r=>r.marketFamily==='moneyline').length,3);
 const props=result.rows.filter(r=>r.marketFamily==='player_prop');
 assert.equal(props.length,2);
 assert.ok(props.every(p=>p.raw.providerEventId==='901'&&p.raw.providerParentId===900));
 assert.ok(props.every(p=>p.sourceObservedAt===null&&!p.executionEligible&&!p.raw.canAuthorizeWager));
});
test('nested soccer fails closed rather than silently dropping malformed specials',()=>{
 const parent={event_id:900,league_name:'Premier League',specials:{not:'array'}};
 assert.throws(()=>normalizePinnoddsMarkets({events:[parent]},{sportId:1,feed:'prematch'}),/NESTED_SPECIALS_CONTRACT_CHANGED/);
 const other={event_id:900,league_name:'Premier League',specials:[{event_id:901,parent_id:1000}]};
 assert.throws(()=>normalizePinnoddsMarkets({events:[other]},{sportId:1,feed:'prematch'}),/NESTED_PARENT_CONFLICT/);
});
