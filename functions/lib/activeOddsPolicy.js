/**
 * Owner-approved market sources, 2026-11-06.
 * Statistics/model inputs remain a separate source policy.
 * Historical records are retained; market permission grants no wager authority.
 */
export const ACTIVE_ODDS_PROVIDER = "PinnOdds";
export const ACTIVE_MARKET_SOURCES=Object.freeze(["PinnOdds","Kalshi","Kalshi REST","Kalshi WebSocket","Polymarket","Polymarket REST","Polymarket WebSocket","Polymarket US","Polymarket US WebSocket"]);
export const ACTIVE_MARKET_FEEDS = ACTIVE_MARKET_SOURCES;
export const RETIRED_ODDS_PROVIDERS = Object.freeze([
 "Parlay","TheOdds","SharpAPI","TheRundown","ACTION",
 "Apify","PrizePicks paid/Apify","PrizePicks GitHub Mirror","ESPN sportsbook reference",
]);
export function isActiveOddsProvider(value) {
 return String(value??"").trim().toLowerCase()==="pinnodds";
}
export function allowNewMarketObservation(value) {
 return ACTIVE_MARKET_FEEDS.includes(String(value?.source??"").trim());
}
export function retiredOddsCollectorResponse(source="LEGACY_ODDS"){
 return {
  ok:false,blocked:true,source,activeOddsSource:ACTIVE_ODDS_PROVIDER,activeMarketSources:ACTIVE_MARKET_SOURCES,
  activeMarketFeeds:ACTIVE_MARKET_FEEDS,
  error:"MARKET_INGESTOR_RETIRED_APPROVED_FEEDS_ONLY",canQualify:false,canAuthorizeWager:false,
 };
}
export function pinnoddsOnlySlateMarket(game={}){
 // Do not leak legacy sportsbook quotes, soft books or Pinnacle-through-Parlay
 // into the active decision path. Pure game projections and statistics stay intact.
 const {odds:previous,market:oldMarket,pin:oldPin,...rest}=game;
 return {...rest,
  odds:{providerSource:"PinnOdds",source:"PinnOdds",sourceObservedAt:null,
   capturedAt:null,marketAvailable:false,pinPresent:false},
  market:null,pin:null,rec:null,lean:null,
  qualificationBlocked:true,canQualify:false,canAuthorizeWager:false,
  activeOddsSource:"PinnOdds",activeOddsPolicy:"APPROVED_MARKETS_ONLY",
  activeMarketSources:ACTIVE_MARKET_SOURCES,
 };
}
