/**
 * FBIS active market-source policy (2026-10-14).
 * Three approved active market feeds:
 *   PinnOdds — sportsbook quotes/reference research.
 *   Polymarket US + WebSocket — exchange market observations.
 *   PrizePicks GitHub Mirror — ONE existing free pick'em feed.
 * All other sportsbook/paid odds collectors are retired.
 * Historical observations are retained unchanged for audit/CLV.
 * Market-source permission is distinct from bet/execution authorization.
 */
export const ACTIVE_ODDS_PROVIDER = "PinnOdds";
export const ACTIVE_MARKET_FEEDS = Object.freeze([
  "PinnOdds",
  "Polymarket US",
  "Polymarket US WebSocket",
  "PrizePicks GitHub Mirror",
]);
export const RETIRED_ODDS_PROVIDERS = Object.freeze([
 "Parlay","TheOdds","SharpAPI","TheRundown","ACTION",
 "PrizePicks paid/Apify","Kalshi","ESPN sportsbook reference",
]);
export function isActiveOddsProvider(value) {
 return String(value??"").trim().toLowerCase()==="pinnodds";
}
export function allowNewMarketObservation(value) {
 return ACTIVE_MARKET_FEEDS.includes(String(value?.source??"").trim());
}
export function retiredOddsCollectorResponse(source="LEGACY_ODDS"){
 return {
  ok:false,blocked:true,source,activeOddsSource:ACTIVE_ODDS_PROVIDER,
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
  activeOddsSource:"PinnOdds",activeOddsPolicy:"PINNODDS_ONLY",
 };
}
