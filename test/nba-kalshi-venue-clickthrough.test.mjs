import test from "node:test";
import assert from "node:assert/strict";
import {buildMoneylinePriceComparison} from "../src/lib/marketPriceComparison.js";
import {exchangeMarketLink} from "../src/lib/exchangeMarketLinks.js";
const game={id:"4019",sport:"nba",start:"2026-10-27T00:00:00Z",home:{name:"Boston Celtics"},away:{name:"New York Knicks"},pHome:.6,
 market:{venueOffers:[{source:"Kalshi",marketFamily:"moneyline",period:"full_game",side:"home",
 ticker:"KXNBAGAME-26OCT26BOSNYK-BOS",eventTicker:"KXNBAGAME-26OCT26BOSNYK",
 yesAskDollars:.58,yesBidDollars:.54,fetchedAt:"2026-10-26T21:00:00Z"}]}};
test("Kalshi moneyline uses observed YES ask, not bid; exact market URL",()=>{
 const {rows}=buildMoneylinePriceComparison(game);
 const home=rows.find(r=>r.side==="home");
 assert.equal(home.kalshiProbability,.58);
 assert.ok(home.kalshiAmerican<0);
 const link=exchangeMarketLink(home.kalshiOffer);
 assert.equal(link.provider,"Kalshi");
 assert.equal(link.scope,"MARKET");
 assert.ok(link.url.includes("op_market_ticker=KXNBAGAME-26OCT26BOSNYK-BOS"));
});
test("No Kalshi quote must not invent a Kalshi market or link",()=>{
 const {rows}=buildMoneylinePriceComparison({...game,market:{venueOffers:[]}});
 assert.equal(rows.find(r=>r.side==="home").kalshiProbability,null);
 assert.equal(exchangeMarketLink({source:"Kalshi",ticker:"KXNBAGAME-26OCT26BOSNYK-BOS"}),null);
});
test("Source-supplied unknown Pinnacle URL is not guessed",()=>{
 assert.equal(exchangeMarketLink({source:"PinnOdds",sourceMarketId:"4019"}),null);
});

test("Pinnacle event links only use authenticated source event IDs",()=>{
 const good=exchangeMarketLink({source:"PinnOdds",providerEventId:"100234",marketUrl:"https://www.pinnacle.com/en/basketball/nba/event/100234"});
 assert.equal(good?.provider,"Pinnacle");assert.equal(good?.scope,"EVENT");
 assert.equal(exchangeMarketLink({source:"PinnOdds",providerEventId:"100234",marketUrl:"https://www.pinnacle.com/en/basketball/nba/event/999999"}),null);
 assert.equal(exchangeMarketLink({source:"PinnOdds",providerEventId:"100234",marketUrl:"https://example.com/event/100234"}),null);
});
