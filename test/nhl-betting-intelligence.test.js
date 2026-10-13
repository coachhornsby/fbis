import test from "node:test";
import assert from "node:assert/strict";
import {buildNhlBettingIntelligence,pairedNoVig,impliedProbability} from "../src/lib/nhlBettingIntelligence.js";

const when=new Date("2026-10-13T15:00:00Z");
const game=()=>{
 const now=when.toISOString();
 return {sport:"nhl",id:"nj-det",start:"2026-10-13T22:00:00Z",
  away:{abbr:"NJ",name:"New Jersey Devils"},home:{abbr:"DET",name:"Detroit Red Wings"},
  nhlProV2:{ok:true,home:"DET",away:"NJ",modelId:"NHL-PRO-v2",
    probability:{homeWinIncludingOt:.505,awayWinIncludingOt:.495}},
  nhlUnifiedMoneylineShadow:{probabilityAudit:{ok:true}},
  market:{venueOffers:[]}};
};
const vm=()=>({sport:"nhl",away:{abbr:"NJ",name:"New Jersey Devils",color:"#cc173b"},home:{abbr:"DET",name:"Detroit Red Wings"},market:{},action:{available:false}});
const pinn=(side,americanOdds,ts=when.toISOString())=>({
 source:"PinnOdds",sourceType:"sportsbook",marketFamily:"moneyline",period:"num_0",
 side,americanOdds,sourceMarketId:"p123:0:moneyline:none",collectedAt:ts,
 raw:{collectorCapturedAt:ts,boardAgeMs:20000,sourceObservedAt:null}
});
const poly=(side,extras={})=>({
 source:"Polymarket US WebSocket",marketFamily:"moneyline",
 side,period:"full_game",collectedAt:when.toISOString(),
 raw:{bestBid:.45,bestAsk:.47,sourceObservedAt:null,...extras}
});

test("missing sources are NOT synthesized into model edge, PinnOdds fair, Polymarket ask, or Action signals",()=>{
 const b=buildNhlBettingIntelligence(game(),vm(),{now:when});
 assert.equal(b.modelProbability,.505);
 assert.equal(b.pinnedProbability,null);
 assert.equal(b.gap,null);
 assert.equal(b.poly.ask,null);
 assert.equal(b.polyGap,null);
 assert.equal(b.action.available,false);
 assert.equal(b.canQualify,false);
 assert.equal(b.canAuthorizeWager,false);
 assert.equal(b.headline,"FBIS MODEL · RESEARCH");
});

test("PinnOdds fair probabilities come from paired opposite sides, never one-sided prices",()=>{
 assert.equal(impliedProbability(-110),110/210);
 assert.equal(impliedProbability(120),100/220);
 assert.equal(pairedNoVig(-110,null),null);
 const g=game();g.market.venueOffers=[pinn("home",-130),pinn("away",120)];
 const b=buildNhlBettingIntelligence(g,vm(),{now:when});
 assert.equal(b.selection,"away","research selection follows model-versus-sharp gap, not static team");
 assert.ok(b.pinnedProbability>0.44&&b.pinnedProbability<0.46);
 assert.ok(b.gap>0);
 assert.equal(b.pinnOdds,120);
});

test("Polymarket real BBO is shown as OBSERVED, no made-up depth or net EV",()=>{
 const g=game();g.market.venueOffers=[poly("New Jersey Devils")];
 const b=buildNhlBettingIntelligence(g,vm(),{now:when});
 assert.equal(b.selection,"home","the model favorite remains selection absent comparable reference");
 const g2=game();g2.market.venueOffers=[poly("Detroit Red Wings")];
 const actual=buildNhlBettingIntelligence(g2,vm(),{now:when});
 assert.equal(actual.poly.bid,.45);
 assert.equal(actual.poly.ask,.47);
 assert.equal(actual.poly.spread,.019999999999999962);
 assert.equal(actual.poly.depth,null);
 assert.equal(actual.poly.comparable,false);
 assert.equal(actual.polyGap,null);
 assert.equal(actual.poly.executable,false);
});

test("unverified exchange settlement never yields a probability edge even with live asks",()=>{
 const g=game();g.market.venueOffers=[poly("Detroit Red Wings",{settlementVerified:false})];
 const b=buildNhlBettingIntelligence(g,vm(),{now:when});
 assert.equal(b.polyGap,null);
});

test("stale provider prices, future source clocks, and wrong periods fail closed",()=>{
 const g=game();
 g.market.venueOffers=[
  pinn("home",-120,"2026-10-13T13:00:00Z"),pinn("away",105,"2026-10-13T13:00:00Z"),
  poly("Detroit Red Wings",{bestAsk:.12})
 ];
 const b=buildNhlBettingIntelligence(g,vm(),{now:new Date("2026-10-14T15:00:00Z")});
 assert.equal(b.pinnedProbability,null);
 assert.equal(b.poly.ask,null);
 g.market.venueOffers=[{...pinn("home",-120),period:"num_1"},pinn("away",105)];
 assert.equal(buildNhlBettingIntelligence(g,vm(),{now:when}).pinnedProbability,null);
});

test("Action money/ticket divergence is displayed only from a recent real snapshot; never sharp-proof",()=>{
 const v=vm();
 v.action={available:true,collectedAt:when.toISOString(),
  tickets:{homePct:57,awayPct:43},money:{homePct:74,awayPct:26},
  lineMove:{label:"DET -1.5 -> -2"},advanced:{marketFamily:"spread"}};
 const b=buildNhlBettingIntelligence(game(),v,{now:when});
 assert.equal(b.action.tickets,57);
 assert.equal(b.action.money,74);
 assert.equal(b.action.divergence,17);
 assert.equal(b.action.marketMatched,false);
 assert.equal(buildNhlBettingIntelligence(game(),v,{now:new Date("2026-10-14T15:00:00Z")}).action.available,false);
});

test("unverified/mismatched NHL projections cannot become an invented moneyline lean",()=>{
 const g=game();g.nhlProV2.away="UNKNOWN";
 const b=buildNhlBettingIntelligence(g,vm(),{now:when});
 assert.equal(b.modelProbability,null);
 assert.equal(b.gap,null);
 assert.equal(b.canAuthorizeWager,false);
});
