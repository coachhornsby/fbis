import test from 'node:test';
import assert from 'node:assert/strict';
import {mapPolymarketUsProp,loadCapturedPolymarketUsProps,usPropIndexKey,indexCapturedPolymarketUsProps} from '../functions/lib/polymarketUsProps.js';
const capturedAt='2026-10-26T14:00:00Z',start='2026-10-27T00:30:00Z';
const game={sport:'nba',id:'game',start,home_abbr:'HOU',away_abbr:'ATL',home_name:'Houston Rockets',away_name:'Atlanta Hawks'};
const players=[{sport:'nba',player_id:'4277905',player_name:'Jalen Johnson',team_key:'ATL'}];
const market=()=>({slug:'astatc-nba-atl-hou-2026-10-26-pts-jaljoh-gte10',sportsMarketTypeV2:'SPORTS_MARKET_TYPE_PROP',sportsMarketType:'basketball_player_points',active:true,closed:false,line:10,gameStartTime:start,metadata:{playerId:1078,playerName:'Jalen Johnson'},description:'This market will settle to Yes if Jalen Johnson records 10 or more points. Overtime is included if played. The official box score at the conclusion of the game is used. If the player does not participate, the market settles to the last fair market price.',bestAskQuote:{value:'0.98'},marketSides:[{id:'long',long:true,team:{abbreviation:'ATL'},description:'Yes'},{id:'short',long:false,team:{abbreviation:'ATL'},description:'No',quote:{value:'0.4'}}]});
const event=m=>({id:'156073',startTime:start,homeTeam:{name:'Houston Rockets'},awayTeam:{name:'Atlanta Hawks'},markets:[m],marketCounts:{numMarkets:1}});
test('US props retain inclusive actual threshold, provider athlete ID, outcome IDs and source-price restrictions',()=>{
 const m=market(),rows=mapPolymarketUsProp(m,event(m),game,players,{capturedAt});
 assert.equal(rows.length,2);assert.equal(rows[0].canonicalPlayerId,'nba:espn:4277905');assert.equal(rows[0].providerPlayerId,'1078');assert.equal(rows[0].line,10);assert.equal(rows[0].comparisonOperator,'gte');assert.equal(rows[1].observedReferencePrice,.4);
 assert.ok(rows.every(r=>r.venue==='Polymarket US'&&r.identityVerified&&!r.priceVerified&&!r.canAuthorizeWager&&r.purchaseAsk===null&&r.marketUrl===null));
});
test('same player name never substitutes for team, event, rule, stat or exact start evidence',()=>{
 const m=market();
 assert.equal(mapPolymarketUsProp(m,event(m),game,[{...players[0],team_key:'LAL'}],{capturedAt}).reason,'US_PROP_ROSTER_TEAM_IDENTITY_UNRESOLVED');
 assert.equal(mapPolymarketUsProp({...m,gameStartTime:'2026-10-28T00:30:00Z'},event(m),game,players,{capturedAt}).reason,'US_PROP_EVENT_OR_START_MISMATCH');
 assert.equal(mapPolymarketUsProp({...m,line:9.5},event(m),game,players,{capturedAt}).reason,'US_PROP_SETTLEMENT_TEMPLATE_UNVERIFIED');
 assert.equal(mapPolymarketUsProp({...m,sportsMarketType:'basketball_team_points'},event(m),game,players,{capturedAt}).reason,'US_PROP_STAT_DEFINITION_UNVERIFIED');
 assert.equal(mapPolymarketUsProp({...m,description:m.description+' First half only.'},event(m),game,players,{capturedAt}).reason,'US_PROP_SETTLEMENT_TEMPLATE_UNVERIFIED');
});
test('existing immutable event detail is indexed and delivered; missing or stale inventory stays explicit',async()=>{
 const m=market(),stored=new Map(),root='market-sources/polymarket-us/bootstrap/';
 const env={ARCHIVE:{async get(k){return stored.has(k)?{json:async()=>JSON.parse(stored.get(k))}:null},async put(k,v){stored.set(k,v)}}};
 stored.set(root+'parent.json',JSON.stringify({sport:'nba',capturedAt,events:[{canonicalId:'game',event:{id:'156073'}}]}));
 stored.set(root+'parent-event-0-detail.json',JSON.stringify(event(m)));
 await indexCapturedPolymarketUsProps(env,{parentReceiptId:'parent',eventIndex:0});
 assert.ok(stored.has(usPropIndexKey('nba','game')));
 const read=await loadCapturedPolymarketUsProps(env,{games:[game],players,sport:'nba',now:Date.parse(capturedAt)+1000});
 assert.equal(read.rows.length,2);assert.equal(read.coverage[0].contracts,1);
 const stale=await loadCapturedPolymarketUsProps(env,{games:[game],players,sport:'nba',now:Date.parse(capturedAt)+3*3600000});
 assert.equal(stale.rows.length,0);assert.match(stale.coverage[0].status,/STALE/);
});

test('a provider event omitting advertised markets cannot report complete prop inventory',async()=>{
 const m=market(),eventData={...event(m),marketCounts:{numMarkets:2}};
 const store=new Map([[usPropIndexKey('nba','game'),JSON.stringify({version:1,sport:'nba',canonicalEventId:'game',providerEventId:'156073',detailKey:'market-sources/polymarket-us/bootstrap/detail.json',capturedAt})],['market-sources/polymarket-us/bootstrap/detail.json',JSON.stringify(eventData)]]);
 const env={ARCHIVE:{get:async k=>store.has(k)?{json:async()=>JSON.parse(store.get(k))}:null}};
 const result=await loadCapturedPolymarketUsProps(env,{games:[game],players,now:Date.parse(capturedAt)+1000});
 assert.equal(result.rows.length,0);assert.equal(result.coverage[0].status,'US_PROP_INVENTORY_READ_FAILED');
});
