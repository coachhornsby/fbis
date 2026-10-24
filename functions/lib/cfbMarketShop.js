/**
 * Multi-venue CFB market shopping. Ranks identical outcomes by payout
 * and prices a model edge ONLY when an independently supplied probability
 * exists for that exact side AND exact line.
 * No normal approximation from projected score or win probability to covers.
 */
import {normalizeCfbMarketQuote} from "./cfbMarketState.js";
const n=v=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
const p=v=>{const x=n(v);return x!=null&&x>0&&x<1?x:null;};
const code=o=>String(o||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const key=q=>[q.source,q.marketFamily,q.side,q.line??"",q.sourceMarketId,q.sourceOutcomeId].join("|");
const label=(game,side)=>side==="home"?game.home?.abbr||game.home?.name||"HOME":side==="away"?game.away?.abbr||game.away?.name||"AWAY":side.toUpperCase();
const signed=x=>x>0?"+"+x:String(x);
const americanFromDecimal=d=>d>=2?Math.round((d-1)*100):-Math.round(100/(d-1));
const exactProbability=(game,q)=>{
 const proj=game?.projection||{};
 if(proj?.independent!==true||proj?.maturity!=="PRODUCTION")return null;
 if(q.marketFamily==="moneyline"){
  const home=p(proj.pHome);
  return home==null?null:q.side==="home"?home:1-home;
 }
 // Both p and exact offered line must be independently simulated and pregame-frozen.
 const rows=Array.isArray(game?.cfbLineProbabilities)?game.cfbLineProbabilities:[];
 const r=rows.find(x=>x?.marketFamily===q.marketFamily&&x?.side===q.side
   &&Math.abs(Number(x.line)-Number(q.line))<.000001
   &&x.independent===true&&x.pregameFrozen===true
   &&x.calibrationVerified===true&&x.marketInformed!==true);
 return p(r?.probability);
};
export function buildCfbMarketShopping(game,{now=new Date()}={}){
 const t=now instanceof Date?now.getTime():Date.parse(now);
 const start=Date.parse(game?.start||"");
 const unavailable={source:"FBIS_MARKET_COMPARISON_V1",quotes:[],bestPrices:[],
   valueCandidates:[],bestValue:null,providerCoverage:{PinnOdds:0,"Polymarket US":0,Kalshi:0},
   reason:"PREGAME_MARKET_UNAVAILABLE",researchOnly:true,canAuthorizeWager:false};
 if(!Number.isFinite(t)||!Number.isFinite(start)||t>=start)
  return {...unavailable,reason:"GAME_STARTED_OR_START_UNVERIFIED"};
 const venue=Array.isArray(game?.market?.venueOffers)?game.market.venueOffers:[];
 const pin=Array.isArray(game?.pinnoddsResearch?.offers)?game.pinnoddsResearch.offers:[];
 const owner=Array.isArray(game?.cfbOwnedMarketQuotes)?game.cfbOwnedMarketQuotes:[];
 const items=[...pin,...venue,...owner],unique=new Map();
 for(const input of items){
  const q=normalizeCfbMarketQuote({...input,eventId:String(game.id),sport:"cfb"},{capturedAt:input.capturedAt||input.collectedAt});
  if(!q)continue;
  const stamp=Date.parse(q.collectedAt);
  if(!Number.isFinite(stamp)||stamp>=start||t-stamp<0||t-stamp>45*60000)continue;
  // No incomplete exchange quote masquerades as an executable offer.
  const decimals=n(q.decimalOdds);
  if(decimals==null||decimals<=1||decimals>101)continue;
  const record={...q,americanEquivalent:americanFromDecimal(decimals),
    impliedProbability:1/decimals,providerQuoteClockVerified:!!q.observedAt,
    feesVerified:false,settlementVerified:false,executionEligible:false,
    canAuthorizeWager:false,marketSelection:label(game,q.side)};
  const prior=unique.get(key(q));
  if(!prior||stamp>Date.parse(prior.collectedAt))unique.set(key(q),record);
 }
 const quotes=[...unique.values()].map(q=>{
  const modelProbability=exactProbability(game,q);
  return {...q,modelProbability,
    grossExpectedRoi:modelProbability!=null?modelProbability*q.decimalOdds-1:null,
    grossProbabilityEdge:modelProbability!=null?modelProbability-q.impliedProbability:null,
    netExpectedRoi:null};
 }).sort((a,b)=>a.marketFamily.localeCompare(b.marketFamily)
   ||String(a.line??"").localeCompare(String(b.line??""))||a.source.localeCompare(b.source));
 const groups=new Map(),providerCoverage={"PinnOdds":0,"Polymarket US":0,"Kalshi":0};
 for(const q of quotes){
  providerCoverage[q.source]=(providerCoverage[q.source]||0)+1;
  // Only same exact outcome/line/period compares as an interchangeable contract.
  const k=[q.marketFamily,q.period,q.side,q.line??"ML"].join("|");
  const arr=groups.get(k)||[];arr.push(q);groups.set(k,arr);
 }
 const bestPrices=[...groups.values()].map(arr=>{
  arr.sort((a,b)=>b.decimalOdds-a.decimalOdds
    ||String(b.collectedAt).localeCompare(String(a.collectedAt)));
  const q=arr[0];
  return {marketFamily:q.marketFamily,period:q.period,side:q.side,
   line:q.line,selection:q.marketSelection,source:q.source,americanEquivalent:q.americanEquivalent,
   impliedProbability:q.impliedProbability,contractAsk:q.contractAsk,
   modelProbability:q.modelProbability,grossExpectedRoi:q.grossExpectedRoi,
   quoteCapturedAt:q.collectedAt,priceBasis:q.priceBasis,
   alternativeProviders:arr.slice(1).map(x=>({source:x.source,americanEquivalent:x.americanEquivalent,
     impliedProbability:x.impliedProbability,priceBasis:x.priceBasis})),
   feeVerified:false,executionEligible:false};
 }).sort((a,b)=>(b.grossExpectedRoi??-Infinity)-(a.grossExpectedRoi??-Infinity)
   ||a.marketFamily.localeCompare(b.marketFamily));
 const valueCandidates=bestPrices.filter(q=>q.modelProbability!=null&&q.grossExpectedRoi>0);
 return {source:"FBIS_MARKET_COMPARISON_V1",quotes,bestPrices,valueCandidates,
  bestValue:valueCandidates[0]||null,providerCoverage,reason:!quotes.length?
   "NO_MATCHED_CURRENT_CFB_QUOTES":valueCandidates.length?
   "POSITIVE_GROSS_MODEL_VALUE_UNVERIFIED_NET_FEES":"NO_LINE_SPECIFIC_CALIBRATED_EDGE",
  modelComparisonRequiresExactLine:true,probabilityInputAuthority:"INDEPENDENT_FROZEN_PROBABILITY_ONLY",
  researchOnly:true,canAuthorizeWager:false};
}
