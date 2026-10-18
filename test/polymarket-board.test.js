import test from "node:test";
import assert from "node:assert/strict";
import {loadPolymarketUsBoardOffers,attachPolymarketBoardOffers} from "../functions/lib/polymarketBoard.js";
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

test('board recovery executes against the actual history-shard index schema',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../sql/shards/market-history-v1.sql',import.meta.url),'utf8'));
 sqlite.prepare(`INSERT INTO normalized_market_observations(id,observation_key,source,source_type,sport,canonical_event_id,market_family,period,side,contract_price,source_market_id,collected_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('one','one','Polymarket US WebSocket','prediction_market','nfl','g','moneyline','full_game','home',.55,'m','2026-10-18T14:00:00Z','2026-10-18T14:00:00Z');
 const history={prepare(sql){const st=sqlite.prepare(sql);return {bind(...args){return {all:async()=>({results:st.all(...args)})}}}}};
 const primary={prepare(){return {bind(){return {all:async()=>({results:[]})}}}}};
 const loaded=await loadPolymarketUsBoardOffers(primary,[{id:'g'}],'nfl',{now:new Date('2026-10-18T14:01:00Z'),historyDb:history});
 assert.equal(loaded.diagnostics.historyAvailable,true);
 assert.equal(loaded.byId.get('g')[0].contractPrice,.55);
 assert.equal(loaded.byId.get('g')[0].deliveryStore,'MARKET_HISTORY_RECOVERY');
 sqlite.close();
});

test("board overlay adds display quote without authorizing wagers or changing model",async()=>{
 const seen={sql:null,bindings:null};
 const db={prepare(sql){seen.sql=sql;return{bind(...xs){seen.bindings=xs;return{async all(){return{results:[{
  canonical_event_id:"401872994",sport:"nfl",source:"Polymarket US",
  market_family:"moneyline",source_market_id:"buf-lar",side:"Buffalo Bills",line:null,
  contract_price:0.42,collected_at:"2026-10-12T21:30:00Z",
  execution_eligible:0,can_qualify:0,can_authorize_wager:0
 }]}}}}}}};
 const now=new Date("2026-10-12T22:00:00Z");
 const r=await loadPolymarketUsBoardOffers(db,[{id:"401872994"}],"nfl",{now});
 assert.equal(r.available,true);
 assert.match(seen.sql,/canonical_event_id IN/);
 assert.equal(seen.bindings[0],"nfl");
 const orig={id:"401872994",projection:{home:26,away:27,independent:true},decision:{status:"PASS"},market:{spread:3.5}};
 const o=attachPolymarketBoardOffers([orig],r)[0];
 assert.deepEqual(o.projection,orig.projection);
 assert.deepEqual(o.decision,orig.decision);
 assert.equal(o.market.spread,3.5);
 assert.equal(o.market.venueOffers[0].contractPrice,0.42);
 assert.equal(o.market.venueOffers[0].executionEligible,false);
 assert.equal(o.market.venueOffers[0].canQualify,false);
 assert.equal(o.market.venueOffers[0].americanOdds,null);
 assert.equal(o.market.venueOffers[0].quoteKind,"DISPLAY_REFERENCE_NOT_EXECUTABLE");
 assert.equal(attachPolymarketBoardOffers([{id:"unmatched"}],r)[0].market,undefined);
});
test("unsupported D1 or no canonical games is empty, never a fabricated quote",async()=>{
 const r=await loadPolymarketUsBoardOffers(null,[{id:"1"}],"mlb");
 assert.equal(r.available,false);
 assert.equal(r.byId.size,0);
});

test("NHL board overlay passes only sanitized WebSocket BBO and never implies execution or depth",async()=>{
 const db={prepare(){return{bind(){return{async all(){return{results:[{
  canonical_event_id:"nj-det",sport:"nhl",source:"Polymarket US WebSocket",
  market_family:"moneyline",period:"full_game",side:"Detroit Red Wings",
  source_market_id:"nj-det-det",contract_price:.47,
  collected_at:"2026-10-13T14:58:00Z",source_observed_at:null,
  raw_payload_json:JSON.stringify({bestBid:.45,bestAsk:.47,privateAccountId:"PRIVATE-NEVER-RETURN"}),
  execution_eligible:0,can_qualify:0,can_authorize_wager:0
 }]}}}}}}};
 const r=await loadPolymarketUsBoardOffers(db,[{id:"nj-det"}],"nhl",{now:new Date("2026-10-13T15:00:00Z")});
 const card=attachPolymarketBoardOffers([{id:"nj-det"}],r)[0];
 const quote=card.market.venueOffers[0];
 assert.equal(quote.source,"Polymarket US WebSocket");
 assert.equal(quote.raw.bestBid,.45);
 assert.equal(quote.raw.bestAsk,.47);
 assert.equal("privateAccountId" in quote.raw,false);
 assert.equal(quote.executionEligible,false);
 assert.equal(quote.canQualify,false);
 assert.equal(quote.canAuthorizeWager,false);
 assert.equal(quote.sourceObservedAt,null);
 assert.equal(quote.quoteKind,"OBSERVED_BBO_NOT_GUARANTEED_FILL");
});

test('board reads all event batches and quote pages without 12-offer truncation',async()=>{
 const calls=[];
 const db={prepare(sql){return{bind(...args){calls.push({sql,args});return{async all(){
  const ids=args.slice(1,-5),offset=args.at(-1);
  const count=ids.includes('g0')?(offset===0?500:13):1;
  return{results:Array.from({length:count},(_,i)=>({id:`${offset+i}`,canonical_event_id:ids[0],source:'Polymarket US',market_family:'total',source_market_id:`m${offset+i}`,period:'full_game',side:'over',contract_price:.5,collected_at:'2026-10-13T15:59:00Z',source_observed_at:null}))};
 }}}}}};
 const loaded=await loadPolymarketUsBoardOffers(db,Array.from({length:125},(_,i)=>({id:`g${i}`})),'nhl',{now:new Date('2026-10-13T16:00:00Z')});
 assert.equal(calls.length,5);assert.equal(loaded.byId.get('g0').length,513);
 assert.equal(loaded.diagnostics.requestedEvents,125);assert.equal(loaded.byId.has('g120'),true);
 assert.ok(calls.every(c=>c.args.length<=46));
 assert.equal(loaded.byId.get('g0')[0].observedAt,null);
 assert.equal(loaded.byId.get('g0')[0].temporal.status,'SOURCE_TIME_UNKNOWN');
});
test('recent collection cannot refresh stale or future provider evidence',async()=>{
 const rows=['2026-10-12T12:00:00Z','2026-10-13T16:10:00Z',null].map((time,i)=>({canonical_event_id:'game',source:'Polymarket US',source_market_id:`m${i}`,contract_price:.4,collected_at:'2026-10-13T15:59:00Z',source_observed_at:time}));
 const db={prepare(){return{bind(){return{async all(){return{results:rows}}}}}}};
 const r=await loadPolymarketUsBoardOffers(db,[{id:'game'}],'nhl',{now:new Date('2026-10-13T16:00:00Z')});
 assert.equal(r.byId.get('game').length,1);
 assert.equal(r.byId.get('game')[0].temporal.status,'SOURCE_TIME_UNKNOWN');
});

test('soccer overlay reads PinnOdds with decimal prices and preserves unknown provider clock', async()=>{
 let query='';
 const db={prepare(sql){query=sql;return{bind(){return{async all(){return{results:[{
  canonical_event_id:'match',source:'PinnOdds',market_family:'moneyline',side:'draw',period:'full_game',
  source_market_id:'p:0:ml',decimal_odds:3.4,contract_price:null,source_observed_at:null,
  collected_at:'2026-10-15T05:40:00Z',raw_payload_json:'{"sourceObservedAt":null}'
 }]}}}}}}};
 const r=await loadPolymarketUsBoardOffers(db,[{id:'match'}],'soccer',{now:new Date('2026-10-15T05:45:00Z')});
 assert.match(query,/'PinnOdds'/);
 const o=attachPolymarketBoardOffers([{id:'match',projection:{home:1}}],r)[0];
 assert.equal(o.market.venueOffers[0].decimalOdds,3.4);
 assert.equal(o.market.venueOffers[0].contractPrice,null);
 assert.equal(o.market.venueOffers[0].providerObservedAt,null);
 assert.equal(o.market.venueOffers[0].temporal.prospectiveEvidenceEligible,false);
 assert.equal(o.projection.home,1);
});

test('soccer last PinnOdds capture stays labeled historical without refreshing its clock',async()=>{
 const db={prepare(){return{bind(){return{all:async()=>({results:[{canonical_event_id:'g',source:'PinnOdds',market_family:'moneyline',period:'full_game',side:'home',decimal_odds:2.2,collected_at:'2026-10-15T00:39:00Z',source_observed_at:null}]})}}}}};
 const r=await loadPolymarketUsBoardOffers(db,[{id:'g'}],'soccer',{now:new Date('2026-10-15T06:05:00Z')});
 const quote=r.byId.get('g')[0];assert.equal(quote.historicalReference,true);assert.equal(quote.collectedAt,'2026-10-15T00:39:00Z');assert.equal(quote.temporal.currentDisplayEligible,false);assert.equal(quote.temporal.prospectiveEvidenceEligible,false);
});

test('fresh history recovery reaches cards without retiming or overwriting newer primary evidence',async()=>{
 const make=(at,price)=>({prepare(){return{bind(){return{all:async()=>({results:[{canonical_event_id:'g',source:'Polymarket US WebSocket',source_market_id:'same-market',source_outcome_id:'yes',side:'home',period:'full_game',market_family:'moneyline',contract_price:price,collected_at:at,source_observed_at:at,raw_payload_json:JSON.stringify({bestAsk:price,offers:[{price,quantity:20}],privateToken:'NEVER'})}]})}}}}});
 const loaded=await loadPolymarketUsBoardOffers(make('2026-10-18T05:59:00Z',.6),[{id:'g'}],'nfl',{now:new Date('2026-10-18T06:00:00Z'),historyDb:make('2026-10-18T05:59:30Z',.58)});
 const offers=loaded.byId.get('g');assert.equal(offers.length,1);assert.equal(offers[0].contractPrice,.58);assert.equal(offers[0].deliveryStore,'MARKET_HISTORY_RECOVERY');assert.equal(offers[0].observedAt,'2026-10-18T05:59:30Z');assert.equal(offers[0].raw.offers[0].quantity,20);assert.ok(!JSON.stringify(offers).includes('NEVER'));assert.equal(offers[0].canAuthorizeWager,false);
 const failed={prepare(){throw Error('primary-unavailable')}};
 assert.equal((await loadPolymarketUsBoardOffers(failed,[{id:'g'}],'nfl',{now:new Date('2026-10-18T06:00:00Z'),historyDb:make('2026-10-18T05:59:30Z',.58)})).available,true);
});
