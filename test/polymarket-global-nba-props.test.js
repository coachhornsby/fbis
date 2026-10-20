import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGlobalNbaProp,verifyGlobalNbaFixture,capturePolymarketGlobalNba,loadPolymarketGlobalNba} from '../functions/lib/polymarketGlobalNbaProps.js';
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
 assert.equal((await loadPolymarketGlobalNba({ARCHIVE},{day:'2026-10-20',now:now.getTime()+3*3600_000})).status,'STALE');
});
