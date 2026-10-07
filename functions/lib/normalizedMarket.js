import { americanProfit, americanToImplied, impliedToAmerican, expectedRoi, twoWayMarket } from "./pricing.js";

const n=v=>{if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null};
const s=v=>{const x=String(v??"").trim();return x||null};

export const MARKET_SOURCE_TYPE=Object.freeze({PICKEM:"pickem",SPORTSBOOK:"sportsbook",EXCHANGE:"exchange"});
export const MARKET_STANDARD_TYPE=Object.freeze({STANDARD:"standard",ALTERNATE:"alternate",UNKNOWN:"unknown"});

export function decimalFromAmerican(odds){
  const a=n(odds); if(a==null||Math.abs(a)<100||a===0)return null;
  return a>0?1+a/100:1+100/Math.abs(a);
}
export function normalizeMarketOffer(input={}){
  const americanOdds=n(input.americanOdds);
  return {
    source:s(input.source),sourceType:s(input.sourceType),sport:s(input.sport),league:s(input.league),
    eventId:s(input.eventId),eventStart:s(input.eventStart),homeTeam:s(input.homeTeam),awayTeam:s(input.awayTeam),
    playerId:s(input.playerId),playerName:s(input.playerName),team:s(input.team),opponent:s(input.opponent),
    marketFamily:s(input.marketFamily),statFamily:s(input.statFamily),side:s(input.side)?.toLowerCase()||null,
    line:n(input.line),americanOdds,decimalOdds:n(input.decimalOdds)??decimalFromAmerican(americanOdds),
    contractPrice:n(input.contractPrice),payoutMultiplier:n(input.payoutMultiplier),
    standardOrAlt:s(input.standardOrAlt)||MARKET_STANDARD_TYPE.UNKNOWN,promo:input.promo==null?null:Boolean(input.promo),
    period:s(input.period),sourceMarketId:s(input.sourceMarketId),sourceOutcomeId:s(input.sourceOutcomeId),
    fetchedAt:s(input.fetchedAt),executionEligible:input.executionEligible==null?null:Boolean(input.executionEligible),
    raw:input.raw??null,
  };
}
export function priceMarketOffer(offer,{modelProbability=null,pairedAmericanOdds=null}={}){
  const o=normalizeMarketOffer(offer),p=n(modelProbability);
  const breakEven=americanToImplied(o.americanOdds);
  const pair=pairedAmericanOdds==null?null:twoWayMarket(o.americanOdds,pairedAmericanOdds);
  return {...o,rawImpliedProbability:breakEven,noVigMarketProbability:pair?.complete?pair.noVigA:null,
    modelProbability:p,fairAmericanPrice:p==null?null:impliedToAmerican(p),
    probabilityEdge:p==null||breakEven==null?null:p-breakEven,
    expectedReturnPerUnitRisk:p==null||o.americanOdds==null?null:expectedRoi(p,o.americanOdds),
    profitPerUnitWin:o.americanOdds==null?null:americanProfit(o.americanOdds,1)};
}
