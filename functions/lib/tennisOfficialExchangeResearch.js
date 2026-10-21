import {matchKalshiTennisResearch} from "./tennisKalshiResearch.js";
import {matchPolymarketGlobalTennis} from "./tennisPolymarketGlobal.js";
import {compareTennisExchangeResearch} from "./tennisExchangeCompare.js";

/**
 * Official projected Tennis cards and ESPN research cards must show the same
 * independent source observations. Reuse the R2 snapshots already loaded for
 * independent cards; the public TODAY read never requests live provider data.
 * Exchange prices remain research-only and never change FBIS model outputs.
 */
export function attachOfficialTennisExchangeResearch(games, {kalshi={},polymarket={},now=new Date()}={}){
 for(const game of games||[]){
  const t=game?.tennisProjection;
  if(game?.sport!=="tennis"||!t||t.researchFixture||t.eventIntegrity?.valid!==true)continue;
  const fixture={tour:String(game.tour||t.tour||"").toLowerCase(),
   start:game.start,home_name:game.home?.fullName||game.home?.name,
   away_name:game.away?.fullName||game.away?.name};
  const kalshiResearchOffers=matchKalshiTennisResearch(fixture,kalshi[fixture.tour]||[],now);
  const polymarketGlobalOffers=matchPolymarketGlobalTennis(fixture,polymarket.events||[],{
   now,asOf:polymarket.asOf||now.toISOString()});
  const comparisons=compareTennisExchangeResearch(
   [fixture.away_name,fixture.home_name],kalshiResearchOffers,polymarketGlobalOffers);
  game.tennisProjection={...t,kalshiResearchOffers,polymarketGlobalOffers,
   kalshiResearchStatus:kalshi[fixture.tour+"Status"]||kalshi.status||"NO_FRESH_SNAPSHOT",
   polymarketGlobalStatus:polymarket.ok?(polymarket.partial?"PARTIAL_SNAPSHOT":"FRESH_SNAPSHOT"):(polymarket.code||"SNAPSHOT_UNAVAILABLE"),
   exchangeResearch:{kalshi:kalshiResearchOffers,polymarket:polymarketGlobalOffers,
    comparisons,comparisonStatus:comparisons.length?"RESEARCH_PRICE_PAIR":"NO_MATCHED_SAME_OUTCOME_PAIR"}};
 }
 return games;
}
