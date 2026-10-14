/**
 * FBIS active market-source policy (2026-10-14).
 * The only authorized NEW price/odds acquisition is PinnOdds.
 * Historical observations are retained unchanged for audit/CLV.
 * Market-source permission is distinct from bet/execution authorization.
 */
export const ACTIVE_ODDS_PROVIDER = "PinnOdds";
export const RETIRED_ODDS_PROVIDERS = Object.freeze([
 "Parlay","TheOdds","SharpAPI","TheRundown","ACTION","Polymarket US",
 "Polymarket US WebSocket","PrizePicks GitHub Mirror",
 "PrizePicks","Kalshi","ESPN sportsbook reference",
]);
export function isActiveOddsProvider(value) {
 return String(value??"").trim().toLowerCase()==="pinnodds";
}
export function allowNewMarketObservation(value) {
 return isActiveOddsProvider(value?.source);
}
export function retiredOddsCollectorResponse(source="LEGACY_ODDS"){
 return {
  ok:false,blocked:true,source,activeOddsSource:ACTIVE_ODDS_PROVIDER,
  error:"ODDS_INGESTOR_RETIRED_PINNODDS_ONLY",canQualify:false,canAuthorizeWager:false,
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
