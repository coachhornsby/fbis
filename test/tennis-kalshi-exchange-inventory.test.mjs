import test from "node:test";
import assert from "node:assert/strict";
import {onRequestGet as exchangeStatus} from "../functions/api/tennis-exchange-status.js";
import {buildTennisResearchSlate} from "../functions/lib/todayBoard.js";
import {normalizeKalshiShadowMarket} from "../functions/lib/kalshiMarketShadow.js";
import {kalshiTennisContractPairs,mergeKalshiTennisCards}
 from "../functions/lib/tennisKalshiInventory.js";
const now=new Date("2026-10-21T14:00:00Z");
const expiry="2026-10-21T20:00:00Z";
const eventTicker="KXATPMATCH-26OCT21DODCEC";
const common={sport:"atp",status:"active",eventTicker,
 fetchedAt:"2026-10-21T13:56:00Z",expectedExpirationAt:expiry,
 rulesPrimary:"This professional tennis match is between Matej Dodig and Marco Cecchinato."};
const rows=[
 {...common,ticker:eventTicker+"-DOD",yesLabel:"Matej Dodig",yesAskDollars:0.72,yesBidDollars:0.69},
 {...common,ticker:eventTicker+"-CEC",yesLabel:"Marco Cecchinato",yesAskDollars:0.30,yesBidDollars:0.28}
];
const kalshi={atp:rows,wta:[],status:"RESEARCH_SNAPSHOT",atpStatus:"COMPLETE_RESEARCH_SNAPSHOT"};
test("Kalshi creates two-sided ATP contract inventory without Polymarket or ESPN",()=>{
 const events=kalshiTennisContractPairs(kalshi,now);
 assert.equal(events.length,1);
 assert.equal(events[0].offers.length,2);
 assert.equal(events[0].offers[0].yesAskDollars,0.30);
 assert.equal(events[0].canAuthorizeWager,false);
 const result=mergeKalshiTennisCards([],kalshi,{date:"2026-10-21",now});
 assert.equal(result.added.length,1);
 const game=result.games[0];
 assert.equal(game.id,"tennis:kalshi:atp:"+eventTicker);
 assert.equal(game.tennisProjection.researchFixture.source,"KALSHI_PUBLIC_SHADOW");
 assert.equal(game.tennisProjection.player1WinProb,null);
 assert.equal(game.startTimeBasis,"KALSHI_CONTRACT_EXPIRATION_ONLY");
 assert.equal(game.tennisProjection.kalshiResearchOffers.length,2);
 assert.equal(game.canAuthorizeWager,false);
 assert.equal(game.market.marketAvailable,false);
});
test("Kalshi enriches independently scheduled Polymarket card with two outcomes",()=>{
 const game={id:"tennis:polyus:atp:555",sport:"tennis",tour:"atp",start:expiry,
  home:{name:"Matej Dodig"},away:{name:"Marco Cecchinato"},
  tennisProjection:{researchFixture:{source:"POLYMARKET_US_PUBLIC",verified:true},
   player1WinProb:null,venueOffers:[{source:"Polymarket US",contractPrice:.65}]}};
 const r=mergeKalshiTennisCards([game],kalshi,{date:"2026-10-21",now});
 assert.equal(r.added.length,0);
 assert.equal(r.games[0].id,game.id);
 assert.equal(r.games[0].tennisProjection.kalshiResearchOffers.length,2);
 assert.equal(r.games[0].tennisProjection.venueOffers[0].contractPrice,.65);
});
test("Kalshi cannot turn provider administrative expiry into an FBIS win prediction",()=>{
 const game={id:"projected",sport:"tennis",tour:"atp",start:expiry,
 home:{name:"Matej Dodig"},away:{name:"Marco Cecchinato"},
 tennisProjection:{player1WinProb:.57,eventIntegrity:{valid:true},venueOffers:[]}};
 const r=mergeKalshiTennisCards([game],kalshi,{date:"2026-10-21",now});
 assert.equal(r.added.length,0);
 assert.equal(r.games[0].tennisProjection.player1WinProb,.57);
 assert.equal(r.games[0].tennisProjection.kalshiResearchOffers.length,2);
});
test("one-sided, stale, mismatched rules, and provider-expired Kalshi offers do not become matches",()=>{
 const bad=[
  {...kalshi,atp:[rows[0]]},
  {...kalshi,atp:rows.map(r=>({...r,fetchedAt:"2026-10-21T10:00:00Z"}))},
  {...kalshi,atp:rows.map(r=>({...r,rulesPrimary:"This professional tennis match features unrelated players."}))},
  {...kalshi,atp:rows.map(r=>({...r,expectedExpirationAt:"2026-10-18T20:00:00Z"}))}
 ];
 for(const source of bad){
  assert.deepEqual(kalshiTennisContractPairs(source,now),[]);
  assert.equal(mergeKalshiTennisCards([],source,{date:"2026-10-21",now}).games.length,0);
 }
});
test("Kalshi-only expirations are included only in their explicitly labeled date bucket",()=>{
 const result=mergeKalshiTennisCards([],kalshi,{date:"2026-10-22",now});
 assert.equal(result.added.length,0);
});

test("exchange health reports Kalshi as available without any Polymarket snapshot",async()=>{
 const at=new Date(),recent=new Date(+at-60000).toISOString(),
  expires=new Date(+at+6*3600000).toISOString();
 const source=rows.map(r=>({...r,fetchedAt:recent,expectedExpirationAt:expires}));
 const progress={version:1,sport:"atp",startedAt:recent,
  pagesFetched:1,cursor:"next",records:source};
 const env={ARCHIVE:{get:async key=>
   key==="kalshi/public-shadow/v1/sports/atp-progress.json"
   ?{json:async()=>progress}:null}};
 const response=await exchangeStatus({env});
 const data=await response.json();
 assert.equal(response.status,200);
 assert.equal(data.status,"SINGLE_EXCHANGE_PRESENT");
 assert.equal(data.sources.kalshi.available,true);
 assert.equal(data.sources.polymarketUs.available,false);
 assert.equal(data.byTour.atp.kalshiContractEvents,1);
 assert.equal(data.canAuthorizeWager,false);
});

test("official TODAY Tennis board retains Kalshi-only match without ESPN, model DB, or Polymarket",async()=>{
 const source={version:1,sport:"atp",startedAt:"2026-10-21T13:30:00Z",
  pagesFetched:1,cursor:"continuation",records:rows};
 const env={ARCHIVE:{get:async key=>
  key==="kalshi/public-shadow/v1/sports/atp-progress.json"
  ?{json:async()=>source}:null}};
 const board=await buildTennisResearchSlate("2026-10-21",env,{now});
 assert.equal(board.games.length,1);
 assert.equal(board.games[0].tennisProjection.researchFixture.source,"KALSHI_PUBLIC_SHADOW");
 assert.equal(board.games[0].tennisProjection.player1WinProb,null);
 assert.equal(board.games[0].tennisProjection.kalshiResearchOffers.length,2);
 assert.equal(board.games[0].canAuthorizeWager,false);
 assert.equal(board.research.configured,true);
});

test("real Kalshi Challenger market format uses occurrence_datetime for source match timing",()=>{
 const common={sport:"atp_challenger",status:"active",
  event_ticker:"KXATPCHALLENGERMATCH-26OCT21PDAJAR",
  occurrence_datetime:"2026-10-22T00:00:00Z",
  expected_expiration_time:"2026-10-22T00:00:00Z",
  rules_primary:"If Pucinelli de Almeida wins the Pucinelli de Almeida vs Jarry professional tennis match in the 2026 ATP Challenger Cali, the market resolves to Yes."};
 const markets=[
  {...common,ticker:common.event_ticker+"-PDA",yes_sub_title:"Matheus Pucinelli de Almeida",
   yes_ask_dollars:"0.5300"},
  {...common,ticker:common.event_ticker+"-JAR",yes_sub_title:"Nicolas Jarry",
   yes_ask_dollars:"0.4800",
   rules_primary:"If Nicolas Jarry wins the Pucinelli de Almeida vs Jarry professional tennis match in the 2026 ATP Challenger Cali, the market resolves to Yes."}
 ];
 const source=markets.map(m=>normalizeKalshiShadowMarket(m,
  {sport:"atp_challenger",fetchedAt:now.toISOString()}));
 assert.equal(source[0].occurrenceAt,"2026-10-22T00:00:00.000Z");
 const events=kalshiTennisContractPairs({atp_challenger:source},now);
 assert.equal(events.length,1);
 assert.equal(events[0].tour,"atp");
 assert.equal(events[0].seriesSport,"atp_challenger");
 assert.equal(events[0].providerTimeStatus,"PROVIDER_OCCURRENCE_TIME");
 assert.equal(events[0].offers.length,2);
 const result=mergeKalshiTennisCards([],{atp_challenger:source},{
  date:"2026-10-21",now});
 assert.equal(result.added.length,1);
 assert.equal(result.games[0].startTimeBasis,"KALSHI_PROVIDER_OCCURRENCE");
 assert.equal(result.games[0].canAuthorizeWager,false);
});
test("independent Kalshi ITF singles and doubles retain their own match categories",()=>{
 for(const [sport,prefix,pair] of [
  ["itf_men","KXITFMATCH",["Dan Added","Daniel Domingos"]],
  ["itf_women","KXITFWMATCH",["Anastasia Gasanova","Maaya Rajeshwaran Revathi"]],
  ["itf_doubles","KXITFDOUBLES",["Alec Deckers / Noah Zamora","Dan Added / Daniel Domingos"]]]){
   const ev=prefix+"-26OCT21TEST";
   const rules="This tennis match features "+pair[0]+" vs "+pair[1]+".";
   const markets=pair.map((p,i)=>({
    sport,status:"active",eventTicker:ev,ticker:ev+"-"+i,
    yesLabel:p,yesAskDollars:i?0.45:0.56,rulesPrimary:rules,
    fetchedAt:"2026-10-21T13:58:00Z",
    occurrenceAt:"2026-10-21T22:00:00Z",
    expectedExpirationAt:"2026-10-22T00:00:00Z"}));
   const observed=kalshiTennisContractPairs({[sport]:markets},now);
   assert.equal(observed.length,1,sport);
   assert.equal(observed[0].tour,sport);
   assert.equal(observed[0].offers.length,2);
   assert.equal(observed[0].canAuthorizeWager,false);
 }
});
