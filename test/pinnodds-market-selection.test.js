import test from "node:test";
import assert from "node:assert/strict";
import {pinnoddsMarketOrder,selectPinnoddsGameMarkets} from "../src/lib/pinnoddsMarketSelection.js";
import {selectPinnoddsBoardOffers} from "../functions/lib/pinnoddsBoardResearch.js";

const snapshot="2026-10-15T12:00:00Z";
const quote=(marketFamily,side,line,decimalOdds,sourceMarketId,standardOrAlt="unknown")=>({
  source:"PinnOdds",marketFamily,side,line,decimalOdds,sourceMarketId,
  standardOrAlt,period:"full_game",capturedAt:snapshot,
});
const game={sport:"cfb",pinnoddsResearch:{latestCapturedAt:snapshot,offers:[
  quote("spread","away",-15,1.909,"spread-15"),
  quote("spread","home",15,1.952,"spread-15"),
  quote("spread","away",-14.5,1.7,"spread-14.5"),
  quote("spread","home",14.5,2.2,"spread-14.5"),
  quote("total","over",56.5,1.91,"total-56.5"),
  quote("total","under",56.5,1.91,"total-56.5"),
  quote("moneyline","away",null,1.51,"ml"),
  quote("moneyline","home",null,2.67,"ml")
]}};

test("football and basketball prioritize the paired spread and total",()=>{
 for(const sport of ["cfb","nfl","cbb","nba","wnba"])assert.deepEqual(pinnoddsMarketOrder(sport),["spread","total"]);
 const x=selectPinnoddsGameMarkets(game);
 assert.equal(x.families.spread.marketKey,"15");
 assert.deepEqual(x.families.spread.quotes.map(q=>q.american),[-110,-105]);
 assert.deepEqual(x.families.spread.quotes.map(q=>q.line),[-15,15]);
 assert.deepEqual(x.families.total.quotes.map(q=>q.side),["over","under"]);
 assert.deepEqual(x.families.total.quotes.map(q=>q.american),[-110,-110]);
 assert.equal(x.families.spread.providerMainUnverified,true);
 assert.equal(x.researchOnly,true);
});
test("hockey/baseball put total before the secondary handicap; moneyline shown independently first",()=>{
 for(const sport of ["nhl","mlb","npb","kbo"])assert.deepEqual(pinnoddsMarketOrder(sport),["total","spread"]);
});
test("never combine different spread lines, source markets or collection batches",()=>{
 const a=quote("spread","away",-15,1.91,"one");
 const b=quote("spread","home",15,1.91,"two");
 assert.equal(selectPinnoddsGameMarkets({sport:"cfb",pinnoddsResearch:{offers:[a,b]}}).families.spread,null);
 const c=quote("spread","home",14,1.91,"one");
 assert.equal(selectPinnoddsGameMarkets({sport:"cfb",pinnoddsResearch:{offers:[a,c]}}).families.spread,null);
 const old={...b,sourceMarketId:"one",capturedAt:"2026-10-14T12:00:00Z"};
 assert.equal(selectPinnoddsGameMarkets({sport:"cfb",pinnoddsResearch:{offers:[a,old]}}).families.spread,null);
});
test("full-game only; reject unpaired total and invalid prices",()=>{
 const bad=quote("total","over",55.5,1.91,"u"),bad2=quote("total","under",55.5,1,"u");
 assert.equal(selectPinnoddsGameMarkets({sport:"cfb",pinnoddsResearch:{offers:[bad,bad2]}}).families.total,null);
 assert.equal(selectPinnoddsGameMarkets({sport:"cfb",pinnoddsResearch:{offers:[quote("total","over",55.5,1.91,"u"),{...quote("total","under",55.5,1.91,"u"),period:"first_half"}]}}).families.total,null);
});
test("explicit main/standard pair beats near-even alternate pair",()=>{
 const selected=selectPinnoddsGameMarkets({sport:"cfb",pinnoddsResearch:{offers:[
 ...game.pinnoddsResearch.offers,quote("spread","away",-16,1.8,"main-16","standard"),quote("spread","home",16,2.05,"main-16","standard")
 ]}}).families.spread;
 assert.equal(selected.marketKey,"16");
 assert.equal(selected.primaryVerified,true);
});

test("board bridge retains provider standard designation and keeps one provider market ID per pair",()=>{
  const make=(side,line,odds,id,standard_or_alt)=>({
    source:"PinnOdds",canonical_event_id:"401862800",market_family:"spread",
    period:"full_game",side,line,decimal_odds:odds,
    collected_at:"2026-10-15T12:00:00Z",event_start_time:"2026-10-16T02:00:00Z",
    source_market_id:id,standard_or_alt,
  });
  const rows=[
    make("away",-14.5,1.91,"alt-14.5","alternate"),make("home",14.5,1.91,"alt-14.5","alternate"),
    make("away",-15,1.83,"main-15","standard"),make("home",15,2.01,"main-15","standard"),
  ];
  const mapped=selectPinnoddsBoardOffers(rows,{now:"2026-10-15T13:00:00Z"});
  assert.equal(mapped["401862800"].offers.filter(x=>x.marketFamily==="spread").length,2);
  const game={sport:"cfb",pinnoddsResearch:mapped["401862800"]};
  const selected=selectPinnoddsGameMarkets(game).families.spread;
  assert.equal(selected.marketKey,"15");
  assert.equal(selected.primaryVerified,true);
  assert.equal(selected.quotes[0].american,-120);
  assert.equal(selected.quotes[1].american,101);
});
