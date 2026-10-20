/**
 * Deprecated 2026-10-20.
 * Legacy direct Kalshi sentiment used unverified team-name matches,
 * incomplete market-side pairings, and mixed cents/dollars. Do not reactivate
 * or silently fan out public Kalshi API requests from per-visitor slate builds.
 *
 * Read-only research lives in the scheduled R2 collector instead.
 */
export const KALSHI_SERIES = Object.freeze({
  mlb:"KXMLBGAME",nfl:"KXNFLGAME",nba:"KXNBAGAME",cfb:"KXNCAAFGAME",
});
export async function attachKalshiSentiment(games=[],sport,_cache=null,_options={}){
  const series=KALSHI_SERIES[String(sport||"").toLowerCase()]||null;
  return {
    games,
    meta:{
      enabled:false,series,matched:0,
      provider:"kalshi-legacy-disabled",
      reason:"UNVERIFIED_EVENT_SIDE_AND_UNIT_MAPPING",
      replacement:"/api/kalshi-market-shadow",
      canChangeProjection:false,canQualify:false,canAuthorizeWager:false,
    },
  };
}
