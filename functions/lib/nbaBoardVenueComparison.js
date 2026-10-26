import {nbaNetWagerCandidates} from "./nbaLiveVenueRanker.js";
// Explicitly adapt only the provider evidence present on today's board.
// Unsupported venues and display-only quotes must NEVER become actionable odds.
export function nbaBoardVenueComparison(game,{now=new Date().toISOString()}={}){
 const raw=[...(game?.pinnoddsResearch?.offers||[]),...(game?.market?.venueOffers||[])];
 const offers=raw.map(o=>{
  const source=String(o.source||o.provider||"");
  const venue=/^pinn(odds|acle)$/i.test(source)?"Pinnacle":/kalshi/i.test(source)?"Kalshi":/polymarket/i.test(source)?"Polymarket":source;
  const family=String(o.marketFamily||o.marketType||o.market||"").toLowerCase();
  const market=family==="moneyline"?"ml":family;
  const side=String(o.side||o.selection||"").toUpperCase();
  const model=game?.nbaFbisV1;
  // This adapter intentionally requires explicit line-specific probability
  // and model qualification; projected scores are not win/cover probabilities.
  const probabilities=game?.nbaMarketProbabilities||{};
  const key=[market,side,o.line??""].join("|");
  const p=probabilities[key];
  const evidence=o?.executionEvidence||{};
  return {
   venue,gameId:String(game?.id||""),market,outcome:side,
   line:o.line,tipoff:game?.start||game?.startTime||game?.dateTime,
   capturedAt:o.providerObservedAt||o.sourceObservedAt||o.observedAt||o.capturedAt||o.collectedAt,
   americanOdds:o.americanOdds,decimalOdds:o.decimalOdds,
   yesPrice:o.contractPrice??o.yesAskDollars,
   isYesContract:evidence.isYesContract===true,
   quoteVerified:evidence.quoteVerified===true&&o.providerTimestampVerified===true,
   actionable:evidence.actionable===true&&o.executionEligible===true,
   settlementEquivalent:evidence.settlementEquivalent===true,
   modelProbability:p?.probability,
   modelQualified:model?.canQualify===true&&p?.qualified===true,
   feePerUnit:evidence.feePerUnit,
   otherCostPerUnit:evidence.otherCostPerUnit,
  };
 });
 const result=nbaNetWagerCandidates({offers,now});
 return {status:result.best?"RANKED_RESEARCH_CANDIDATE":"NO_VERIFIED_ACTIONABLE_COMPARISON",
  offeredVenueCount:new Set(offers.map(x=>x.venue)).size,observedOffers:raw.length,
  ...result,canAuthorizeWager:false};
}
