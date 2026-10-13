import test from "node:test";
import assert from "node:assert/strict";
import {loadPolymarketUsBoardOffers,attachPolymarketBoardOffers} from "../functions/lib/polymarketBoard.js";

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
