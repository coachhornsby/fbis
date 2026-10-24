import test from "node:test";
import assert from "node:assert/strict";
import {matchKalshiCfbMoneylines} from "../functions/lib/cfbKalshiMarkets.js";
import {buildCfbMarketShopping} from "../functions/lib/cfbMarketShop.js";
import {normalizeCfbMarketQuote} from "../functions/lib/cfbMarketState.js";
import {resolveMarketHistoryWriteDb,listMarketHistoryReadDbs} from "../functions/lib/databaseTopology.js";
import {bootstrapWriteTarget} from "../functions/api/polymarket-bootstrap.js";
import {resolveWsPersistTarget} from "../services/polymarket-us-stream/wsPersistTarget.mjs";
import {resolveRecoveryHistoryDb} from "../services/polymarket-us-stream/historyRecovery.mjs";
const now=new Date("2026-10-24T15:00:00Z");
const game={id:"cfb-aub-lsu-2026",sport:"cfb",start:"2026-10-24T16:00:00Z",
 home:{name:"Auburn Tigers",abbr:"AUB"},away:{name:"LSU Tigers",abbr:"LSU"},
 projection:{independent:true,maturity:"PRODUCTION",pHome:.57}};
const kalshi=(side,ticker,ask)=>({provider:"Kalshi",sport:"cfb",seriesTicker:"KXNCAAFGAME",
 ticker,eventTicker:"KXNCAAFGAME-26OCT24LSUAUB",title:side+" wins",yesLabel:side,
 status:"active",marketType:"binary",yesAskDollars:ask,yesAskSize:10,
 rulesPrimary:"If "+side+" wins the LSU vs Auburn college football game originally scheduled for Oct 24, 2026, then the market resolves to Yes.",
 fetchedAt:"2026-10-24T14:58:00Z"});
test("Kalshi CFB pairs match unique independently scheduled fixture and show buy ask only",()=>{
 const records=[kalshi("Auburn","KXNCAAFGAME-26OCT24LSUAUB-AUB",.51),kalshi("LSU","KXNCAAFGAME-26OCT24LSUAUB-LSU",.50)];
 const r=matchKalshiCfbMoneylines(records,[game],{now});
 assert.equal(r.matchedGames,1);
 assert.equal(r.quotes,2);
 const quotes=r.byId.get(game.id);
 assert.equal(quotes.find(x=>x.side==="home").contractPrice,.51);
 assert.equal(quotes.find(x=>x.side==="away").contractPrice,.50);
 assert.ok(quotes.every(x=>x.canAuthorizeWager===false));
 assert.ok(quotes.every(x=>x.settlementVerified===false));
});
test("Kalshi fixture timestamp/identity conflict never becomes a CFB card quote",()=>{
 const records=[kalshi("Auburn","KXNCAAFGAME-26OCT24LSUAUB-AUB",.51),kalshi("LSU","KXNCAAFGAME-26OCT24LSUAUB-LSU",.50)];
 assert.equal(matchKalshiCfbMoneylines(records,[{...game,id:"different",home:{name:"Georgia Bulldogs"},away:{name:"Kentucky Wildcats"}}],{now}).quotes,0);
 assert.equal(matchKalshiCfbMoneylines(records,[game],{now:new Date("2026-10-24T16:05:00Z")}).quotes,0);
 assert.equal(matchKalshiCfbMoneylines(records.map(x=>({...x,fetchedAt:"2026-10-24T12:00:00Z"})),[game],{now}).quotes,0);
});
test("market comparison selects best identical side+line and calculates EV only for exact outcome",()=>{
 const pin={source:"PinnOdds",sport:"cfb",eventId:game.id,marketFamily:"moneyline",side:"home",
   period:"full_game",decimalOdds:2,americanOdds:100,sourceMarketId:"pin-ml",
   capturedAt:"2026-10-24T14:56:00Z"};
 const poly={source:"Polymarket US",sport:"cfb",eventId:game.id,marketFamily:"moneyline",side:"home",
   period:"full_game",contractPrice:.49,sourceMarketId:"poly-ml",raw:{bestAsk:.49},
   collectedAt:"2026-10-24T14:57:00Z"};
 const spread={source:"Polymarket US",sport:"cfb",eventId:game.id,marketFamily:"spread",
   side:"home",line:7.5,period:"full_game",contractPrice:.49,sourceMarketId:"poly-spread",
   capturedAt:"2026-10-24T14:58:00Z"};
 const result=buildCfbMarketShopping({...game,pinnoddsResearch:{offers:[pin]},
   market:{venueOffers:[poly,spread]}},{now});
 assert.equal(result.bestPrices.find(x=>x.marketFamily==="moneyline").source,"Polymarket US");
 assert.equal(result.bestPrices.find(x=>x.marketFamily==="moneyline").impliedProbability,.49);
 assert.equal(result.bestPrices.find(x=>x.marketFamily==="spread").modelProbability,null);
 assert.ok(result.bestValue?.grossExpectedRoi>.16);
 assert.equal(result.canAuthorizeWager,false);
});
test("unverified independent cover models cannot be reused as line-specific probability",()=>{
 const spread={source:"Polymarket US",sport:"cfb",eventId:game.id,marketFamily:"spread",
  side:"home",line:7.5,period:"full_game",contractPrice:.49,sourceMarketId:"x",
  capturedAt:"2026-10-24T14:58:00Z"};
 const result=buildCfbMarketShopping({...game,market:{venueOffers:[spread]}},{now});
 assert.equal(result.bestValue,null);
 const approved=buildCfbMarketShopping({...game,market:{venueOffers:[spread]},
  cfbLineProbabilities:[{marketFamily:"spread",side:"home",line:7.5,probability:.57,
    pregameFrozen:true,calibrationVerified:true,independent:true,marketInformed:false}]},{now});
 assert.ok(approved.bestValue?.grossExpectedRoi>.16);
});
test("CFB hot quote model preserves provider price basis, forbids unverified side",()=>{
 const q=normalizeCfbMarketQuote({source:"Kalshi",sport:"cfb",eventId:game.id,
  marketFamily:"moneyline",side:"home",contractPrice:.49,period:"full_game",
  capturedAt:"2026-10-24T14:55:00Z"});
 assert.equal(q?.contractAsk,.49);
 assert.equal(q?.priceBasis,"PUBLIC_REST_BEST_ASK_INDICATIVE");
 assert.equal(normalizeCfbMarketQuote({source:"Kalshi",eventId:game.id,
  marketFamily:"spread",side:"yes",line:7.5,contractPrice:.49,
  capturedAt:"2026-10-24T14:55:00Z"}),null);
});
test("overflow writes prefer healthy Q4b but preserve readable legacy partitions",async()=>{
 const db=bytes=>({prepare:()=>({all:async()=>({results:[{healthy:1}],meta:{size_after:bytes}}),
    first:async()=>({ok:1})})});
 const env={MARKET_HISTORY_2026Q4B_DB:db(100000),
  MARKET_HISTORY_2026Q4_DB:db(9100000000),MARKET_HISTORY_DB:db(9999998000)};
 const target=await resolveMarketHistoryWriteDb(env,{now});
 assert.equal(target.binding,"MARKET_HISTORY_2026Q4B_DB");
 assert.deepEqual(listMarketHistoryReadDbs(env).map(x=>x.binding),
  ["MARKET_HISTORY_2026Q4B_DB","MARKET_HISTORY_2026Q4_DB","MARKET_HISTORY_DB"]);
 const boot=bootstrapWriteTarget(env,8500000000,100000);
 assert.equal(boot.store,"MARKET_HISTORY_2026Q4B");
 assert.equal(resolveWsPersistTarget(env).store,"MARKET_HISTORY_2026Q4B");
 assert.equal(resolveRecoveryHistoryDb(env).target,"MARKET_HISTORY_2026Q4B_DB");
 const full={...env,MARKET_HISTORY_2026Q4B_DB:db(9700000000)};
 assert.equal((await resolveMarketHistoryWriteDb(full,{now})).db,null);
});
