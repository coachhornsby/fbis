import test from "node:test";
import assert from "node:assert/strict";
import {
 FBIS_POLY_SPORTS, classifyPolymarketUsLeague, chicagoMarketDay,
 matchPolymarketUsEvent, parsePolymarketUsPrice,
 polymarketUsMarketFamily, polymarketUsMarketOffers,
 fetchPolymarketUsLeagues,fetchPolymarketUsLeagueEvents
} from "../functions/lib/polymarketUs.js";

const E={id:"poly-123",title:"Buffalo Bills vs Los Angeles Rams",
 startTime:"2026-10-13T00:15:00Z",
 markets:[{id:"market1",slug:"buf-lar-winner",sportsMarketTypeV2:"SPORTS_MARKET_TYPE_MONEYLINE",
 marketSides:[
  {id:"yes-buf",description:"Buffalo Bills",team:{name:"Buffalo Bills"},quote:{value:0.43}},
  {id:"yes-lar",description:"Los Angeles Rams",team:{name:"Los Angeles Rams"},quote:{value:0.60}}
 ]}]};
const game={id:"401872994",sport:"nfl",start:"2026-10-13T00:15Z",
 away_name:"Buffalo Bills",home_name:"Los Angeles Rams",away_abbr:"BUF",home_abbr:"LAR"};

test("all eleven independently supported FBIS sport scopes are intentionally tracked",()=>{
 assert.equal(FBIS_POLY_SPORTS.length,11);
 assert.equal(new Set(FBIS_POLY_SPORTS).size,11);
 for(const sport of ["nfl","cfb","cbb","nba","wnba","mlb","npb","kbo","nhl","soccer","tennis"])assert.ok(FBIS_POLY_SPORTS.includes(sport));
});
test("league discovery preserves US origin and does not conflate NFL or CFB, CBB or NBA",()=>{
 const pairs=[["NFL","nfl"],["NCAAF","cfb"],["NCAAB","cbb"],["NBA","nba"],["WNBA","wnba"],["MLB","mlb"],["NPB","npb"],["KBO","kbo"],["NHL","nhl"],["ATP","tennis"],["WTA","tennis"],["EPL","soccer"],["MLS","soccer"]];
 for(const [slug,sport] of pairs)assert.equal(classifyPolymarketUsLeague({slug}),sport,slug);
 assert.equal(classifyPolymarketUsLeague({slug:"election-2026"}),null);
});
test("market quote preserves displayed probability and no bogus executable price/odds",()=>{
 const o=polymarketUsMarketOffers(E,"nfl",{canonicalId:"401872994",capturedAt:"2026-10-12T23:50:00Z"});
 assert.equal(o.length,2);
 assert.equal(o[0].contractPrice,0.43);
 assert.equal(o[0].fetchedAt,null,"collector capture is not a provider observation");
 assert.equal(o[0].raw.collectorCapturedAt,"2026-10-12T23:50:00Z");
 assert.equal(o[0].raw.sourceObservedAt,null);
 assert.equal(o[1].contractPrice,0.6);
 assert.equal(o[0].source,"Polymarket US");
 assert.equal(o[0].sourceType,"exchange");
 assert.equal(o[0].americanOdds,null);
 assert.equal(o[0].executionEligible,false);
 assert.equal(o[0].raw.canAuthorizeWager,false);
 assert.equal(o[0].raw.priceKind,"DISPLAY_QUOTE_NOT_BEST_ASK");
 assert.equal(o[0].marketFamily,"moneyline");
 assert.equal(o[0].eventId,"401872994");
 assert.equal(polymarketUsMarketFamily({sportsMarketTypeV2:"SPORTS_MARKET_TYPE_SPREAD"}),"spread");
 assert.equal(polymarketUsMarketFamily({sportsMarketTypeV2:"SPORTS_MARKET_TYPE_TOTAL"}),"total");
 assert.equal(polymarketUsMarketFamily({sportsMarketTypeV2:"nonstandard"}),"unclassified");
});
test("strict unit checks reject 43 or 110 as unvalidated contract prices",()=>{
 for(const v of [null,undefined,"", "  ",{value:null},43,110,-0.1,"garbage"])assert.equal(parsePolymarketUsPrice(v),null);
 assert.equal(parsePolymarketUsPrice({value:"0.2"}),0.2);
});
test("provider events must match two independent teams plus kickoff before canonical linking",()=>{
 assert.deepEqual(matchPolymarketUsEvent(E,[game],"nfl"),{id:"401872994",reason:"TWO_TEAM_KICKOFF_VERIFIED"});
 assert.equal(matchPolymarketUsEvent({...E,startTime:"2026-10-13T11:00:00Z"},[game],"nfl").id,null);
 assert.equal(matchPolymarketUsEvent({...E,title:"Unknown A vs Unknown B",markets:[]},[game],"nfl").id,null);
 assert.equal(matchPolymarketUsEvent(E,[game,{...game,id:"other"}],"nfl").reason,"AMBIGUOUS_EVENT_MATCH");
 assert.equal(chicagoMarketDay(E.startTime),"2026-10-12");
});
test("US public endpoint discovery paginates and rejects silent response-contract changes",async()=>{
 const req=[];
 const fetchImpl=async url=>{
  req.push(url);
  if(url.includes("/v2/leagues/nfl/events"))return {ok:true,json:async()=>({events:[E]})};
  if(url.includes("/v2/leagues?"))return {ok:true,json:async()=>({leagues:[{slug:"nfl"},{slug:"atp"}]})};
  throw Error("unexpected "+url);
 };
 const l=await fetchPolymarketUsLeagues(fetchImpl);
 assert.equal(l.complete,true);
 assert.equal(l.leagues.length,2);
 const e=await fetchPolymarketUsLeagueEvents("nfl",fetchImpl);
 assert.equal(e.length,1);
 assert.ok(req.every(x=>x.startsWith("https://gateway.polymarket.us/")));
 await assert.rejects(fetchPolymarketUsLeagueEvents("../private",fetchImpl),/Invalid public league slug/);
 await assert.rejects(fetchPolymarketUsLeagueEvents("nba",async()=>({ok:true,json:async()=>({data:[]})})),/contract changed/);
});

test("cross-provider NBA nickname display maps to full canonical club only with both sides and kickoff",()=>{
 const e={id:"135229",title:"CLE Cavaliers vs. ORL Magic",startTime:"2026-10-13T23:00:00Z",
   markets:[{marketSides:[{description:"Cavaliers"},{description:"Magic"}]}]};
 const g={id:"401898403",start:"2026-10-13T23:00:00Z",
   home_name:"Orlando Magic",away_name:"Cleveland Cavaliers",
   home_abbr:"ORL",away_abbr:"CLE"};
 assert.equal(matchPolymarketUsEvent(e,[g],"nba").id,g.id);
 assert.equal(matchPolymarketUsEvent({...e,title:"CLE Cavaliers vs. BOS Celtics",markets:[{marketSides:[{description:"Cavaliers"},{description:"Celtics"}]}]},[g],"nba").id,null);
});
test("soccer local alias Lens matches Racing Club de Lens with opponent and kickoff",()=>{
 const e={id:"140430",title:"Racing Club de Lens vs. Sporting CP",startTime:"2026-10-13T16:45:00Z",markets:[]};
 const g={id:"m_0Z7ndF",start:e.startTime,home_name:"Lens",away_name:"Sporting CP"};
 assert.equal(matchPolymarketUsEvent(e,[g],"soccer").id,g.id);
 assert.equal(matchPolymarketUsEvent({...e,title:"Racing Club de Lens vs. Sporting CP",startTime:"2026-10-14T16:45:00Z"},[g],"soccer").id,null);
});
