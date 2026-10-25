import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGlobalNbaProp,verifyGlobalNbaFixture,capturePolymarketGlobalNba,loadPolymarketGlobalNba,listGlobalNbaFixtureSlugs} from '../functions/lib/polymarketGlobalNbaProps.js';
const game={id:'401909088',sport:'nba',date:'2026-10-20',start:'2026-10-20T19:00:00Z',away_abbr:'BOS',home_abbr:'DET'};
const event={id:'1185700',slug:'nba-bos-det-2026-10-20',teams:[{ordering:'away',abbreviation:'bos'},{ordering:'home',abbreviation:'det'}]};
const market={id:'5798017',slug:'nba-bos-det-2026-10-20-points-ausar-thompson-9pt5',
 question:'Ausar Thompson: Points O/U 9.5',sportsMarketType:'points',line:9.5,active:true,closed:false,
 gameStartTime:'2026-10-20 19:00:00+00',outcomes:'["Yes","No"]',outcomePrices:'["0.45","0.55"]',
 description:'This market will resolve to "Yes" if Ausar Thompson scores more than 9.5 points during the game. The entire game including all overtime periods will be considered. If the player is listed as inactive or otherwise does not take the court at any point, the market will resolve "No".'};
const players=[{player_id:'4684742',player_name:'Ausar Thompson',team_key:'DET'}];
test('exact Gamma game, roster, stat, threshold and inactive settlement produce two research-only source prices',()=>{
 assert.equal(verifyGlobalNbaFixture(event,game),true);
 const result=normalizeGlobalNbaProp(market,event,game,players,{capturedAt:'2026-10-20T17:00:00Z'});
 assert.equal(result.length,2);
 assert.equal(result[0].canonicalPlayerId,'nba:espn:4684742');
 assert.equal(result[0].observedReferencePrice,.45);
 assert.equal(result[1].observedReferencePrice,.55);
 assert.equal(result[1].statSide,'under');assert.equal(result[0].line,9.5);
 assert.equal(result[0].dnpSettlement,'NO_IF_INACTIVE');
 assert.equal(result[0].priceVerified,false);
 assert.equal(result[0].observedAsk,null);assert.equal(result[0].purchaseAsk,null);
 assert.equal(result[0].canAuthorizeWager,false);
});
test('Gamma player matching fails closed across event player stat timing settlement and venue evidence',()=>{
 assert.equal(verifyGlobalNbaFixture({...event,slug:'nba-bos-nyk-2026-10-20'},game),false);
 assert.equal(verifyGlobalNbaFixture({...event,teams:[...event.teams].reverse().map(t=>({...t,ordering:t.ordering==='home'?'away':'home'}))},game),false);
 for(const variant of [{line:10.5},{sportsMarketType:'assists'},{gameStartTime:'2026-10-21 19:00:00+00'},
  {description:market.description.replace('will resolve "No"','will resolve "Yes"')},
  {outcomePrices:'["0.45"]'},{outcomePrices:'["0.45","1.10"]'},{active:false}]){
  assert.equal(normalizeGlobalNbaProp({...market,...variant},event,game,players,{capturedAt:'2026-10-20T17:00:00Z'}).length,0);
 }
 assert.equal(normalizeGlobalNbaProp(market,event,game,[...players,{...players[0],player_id:'fake'}],{}).length,0);
});
function dbMock(){
 return {prepare(sql){return {bind(){return {all:async()=>({results:sql.includes('FROM games')?[game]:players})}}}}};
}
test('bounded Gamma collection stores independently verified snapshot and enforces 2h stale gate',async()=>{
 const objects=new Map();
 const ARCHIVE={put:async(k,v)=>objects.set(k,JSON.parse(v)),get:async k=>objects.has(k)?{json:async()=>objects.get(k)}:null};
 let called=0;
 const now=new Date('2026-10-20T17:00:00Z');
 const r=await capturePolymarketGlobalNba({DB:dbMock(),ARCHIVE},{now,fetchImpl:async u=>{
  called++;assert.match(String(u),/gamma-api.polymarket.com\/events\?slug=nba-bos-det-2026-10-20/);
  return Response.json([{...event,markets:[market]}]);
 }});
 assert.equal(r.ok,true);assert.equal(r.contracts,2);assert.equal(called,1);
 const current=await loadPolymarketGlobalNba({ARCHIVE},{day:'2026-10-20',now:now.getTime()+20_000});
 assert.equal(current.rows.length,2);assert.equal(current.status,'RESEARCH_CAPTURED');
 const archiveResult=await loadPolymarketGlobalNba({ARCHIVE},{day:'2026-10-20',now:now.getTime()+3*3600_000});
 assert.equal(archiveResult.status,'HISTORICAL_REFERENCE');
 assert.equal(archiveResult.rows.length,2);
 assert.equal(archiveResult.rows[0].historicalReference,true);
 assert.equal(archiveResult.rows[0].marketAvailable,false);
 assert.equal((await loadPolymarketGlobalNba({ARCHIVE},{day:'2026-10-20',now:now.getTime()+49*3600_000})).status,'STALE');
});

test('GitHub raw Gamma handoff revalidates independently verified fixture and roster without Pages egress',async()=>{
 const now=new Date('2026-10-20T17:00:00Z');
 const plan=await listGlobalNbaFixtureSlugs({DB:dbMock()},{now});
 assert.deepEqual(plan.slugs,['nba-bos-det-2026-10-20']);
 const entries=new Map(),ARCHIVE={put:async(k,v)=>entries.set(k,JSON.parse(v)),get:async k=>entries.has(k)?{json:async()=>entries.get(k)}:null};
 const r=await capturePolymarketGlobalNba({DB:dbMock(),ARCHIVE},{
  now,providedEvents:[{...event,markets:[market]}],
  fetchImpl:async()=>{throw Error('No Pages upstream request should occur')}
 });
 assert.equal(r.contracts,2);assert.equal(r.errors.length,0);
 const bad=await capturePolymarketGlobalNba({DB:dbMock(),ARCHIVE},{
  now,providedEvents:[{...event,teams:[{ordering:'away',abbreviation:'phi'},{ordering:'home',abbreviation:'det'}],markets:[market]}],
  fetchImpl:async()=>{throw Error('Unexpected provider fetch')}
 });
 assert.equal(bad.contracts,0);assert.equal(bad.errors[0].code,'EVENT_IDENTITY_UNRESOLVED');
});

test('NBA ESPN abbreviation aliases resolve Gamma matching only with exact teams',()=>{
 const variants=[
  [{...game,id:'a',away_abbr:'GS',home_abbr:'PHX'},'nba-gsw-phx-2026-10-20','GSW','PHX'],
  [{...game,id:'b',away_abbr:'NO',home_abbr:'DEN'},'nba-nop-den-2026-10-20','NOP','DEN']
 ];
 for(const [g,slug,away,home] of variants)assert.equal(verifyGlobalNbaFixture({slug,teams:[
  {ordering:'away',abbreviation:away.toLowerCase()},{ordering:'home',abbreviation:home.toLowerCase()}]},g),true);
});

test('Later missing Gamma fixtures preserve prior verified NBA source snapshots',async()=>{
 const now=new Date('2026-10-20T17:00:00Z'),memory=new Map();
 const ARCHIVE={put:async(k,v)=>memory.set(k,JSON.parse(v)),get:async k=>memory.has(k)?{json:async()=>memory.get(k)}:null};
 const env={DB:dbMock(),ARCHIVE};
 const first=await capturePolymarketGlobalNba(env,{now,providedEvents:[{...event,markets:[market]}]});
 assert.equal(first.contracts,2);
 const next=await capturePolymarketGlobalNba(env,{now:new Date(now.getTime()+4*3600_000),providedEvents:[]});
 assert.equal(next.contracts,2);
 assert.equal(next.latestCaptureRows,0);
 assert.equal(next.retainedReferenceRows,2);
 const stored=memory.get('player-props/polymarket-global/v1/nba-2026-10-20.json');
 assert.equal(stored.rows[0].collectedAt,'2026-10-20T17:00:00.000Z');
 assert.equal(stored.rows[0].canAuthorizeWager,false);
});

test('Gamma scheduled capture covers today and next Chicago game day with isolated market/freezes',async()=>{
 const now=new Date('2026-10-20T17:00:00Z');
 const later={...game,id:'401909089',date:'2026-10-21',start:'2026-10-21T23:00:00Z'};
 const other={...event,id:'1185701',slug:'nba-bos-det-2026-10-21'};
 const futureMarket={...market,slug:market.slug.replace('2026-10-20','2026-10-21'),
  gameStartTime:'2026-10-21 23:00:00+00'};
 const fakeDb={prepare(sql){return {bind(){return{all:async()=>({results:
   sql.includes('FROM games')?[game,later]:players})}}}}};
 const objects=new Map(),ARCHIVE={get:async key=>objects.has(key)?{json:async()=>objects.get(key)}:null,
  put:async(key,value)=>objects.set(key,JSON.parse(value))};
 const plan=await listGlobalNbaFixtureSlugs({DB:fakeDb},{now});
 assert.deepEqual(plan.days,['2026-10-20','2026-10-21']);
 assert.deepEqual(plan.slugs,[event.slug,other.slug]);
 const result=await capturePolymarketGlobalNba({DB:fakeDb,ARCHIVE},{now,providedEvents:[
  {...event,markets:[market]},{...other,markets:[futureMarket]}]});
 assert.equal(result.contracts,4);
 assert.equal(result.dateReceipts.length,2);
 assert.equal(objects.get('player-props/polymarket-global/v1/nba-2026-10-20.json').rows.length,2);
 assert.equal(objects.get('player-props/polymarket-global/v1/nba-2026-10-21.json').rows.length,2);
 assert.equal(objects.get('player-props/pregame-lines/v1/nba/polymarket/2026-10-21.json').rows.length,2);
});

test('Polymarket preserves unmatched player thresholds as non-executable market-only inventory',async()=>{
 const now=new Date('2026-10-20T17:00:00Z');
 const objects=new Map(),ARCHIVE={
  put:async(k,v)=>objects.set(k,JSON.parse(v)),
  get:async k=>objects.has(k)?{json:async()=>objects.get(k)}:null
 };
 const candidate={...market,id:'unmapped-2',slug:market.slug+'-alt',
  question:'Ausar Thompson: Points O/U 11.5',line:9.5};
 const result=await capturePolymarketGlobalNba({DB:dbMock(),ARCHIVE},{
  now,providedEvents:[{...event,markets:[market,candidate]}],
  fetchImpl:async()=>{throw Error('Unexpected fetch')}
 });
 assert.equal(result.latestCaptureRows,2);
 assert.equal(result.sourceMarketOnly,1);
 const stored=await loadPolymarketGlobalNba({ARCHIVE},{day:'2026-10-20',now:now.getTime()+1000});
 assert.equal(stored.marketOnly.length,1);
 const raw=stored.marketOnly[0];
 assert.equal(raw.provider,'Polymarket');
 assert.equal(raw.identityVerified,false);
 assert.equal(raw.priceVerified,false);
 assert.equal(raw.purchaseAsk,null);
 assert.equal(raw.canAuthorizeWager,false);
 assert.equal(raw.rawTitle,'Ausar Thompson: Points O/U 11.5');
});
