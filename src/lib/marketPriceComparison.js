import {assessPolymarketOffer} from './polymarketIntelligence.js';
import {contractPriceToAmerican, marketDisplayAmerican, marketDisplayImplied} from "./marketQuoteDisplay.js";

const TWO_WAY = new Set(["nfl","cfb","cbb","nba","wnba","nhl","mlb","npb","kbo","tennis"]);
const numeric = v => v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const probability = v => { const n=numeric(v); return n != null && n > 0 && n < 1 ? n : null; };
const normalized = v => String(v ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const aliases = team => {
  const names=[team?.name,team?.fullName,team?.displayName,team?.abbr,team?.nickname,team?.mascot].filter(Boolean);
  const result=new Set(names.map(normalized));
  for (const name of names) {
    const parts=normalized(name).split(" ").filter(Boolean);
    if(parts.length>1)result.add(parts.at(-1));
  }
  result.delete("");
  return result;
};
function resolveSide(offer,game) {
  const side=normalized(offer?.side);
  if(side === "draw" || side === "tie") return String(game?.sport).toLowerCase()==="soccer" ? "draw" : null;
  if(side==="home" || side==="away") return side;
  const home=aliases(game?.home).has(side),away=aliases(game?.away).has(side);
  return home!==away?(home?"home":"away"):null;
}
const currentFirst = (a,b) => {
  const stream=x=>x?.source==="Polymarket US WebSocket"?1:0;
  return Date.parse(b?.sourceObservedAt||b?.collectedAt||0)-Date.parse(a?.sourceObservedAt||a?.collectedAt||0) || stream(b)-stream(a);
};
function modelProbabilities(game) {
  const sport=String(game?.sport||"").toLowerCase();
  if (sport==="soccer") {
    const one=game?.subprojections?.oneXTwo||game?.subprojections?.soccer?.oneXTwo||
      game?.soccerFbis?.oneXTwo||game?.soccerFbisV2?.oneXTwo;
    return {home:probability(one?.home),draw:probability(one?.draw),away:probability(one?.away)};
  }
  if(!TWO_WAY.has(sport))return {home:null,away:null};
  const home=probability(game?.pHome ?? game?.model?.pHomeFinal ?? game?.projection?.pHome);
  return {home,away:home==null?null:1-home};
}
export function buildMoneylinePriceComparison(game={},options={}) {
  const sport=String(game.sport||"").toLowerCase();
  const sources=Array.isArray(game?.market?.venueOffers)?game.market.venueOffers:[];
  const pin=[...(game?.pinnoddsResearch?.offers||[]),...sources.filter(o=>o.source==="PinnOdds")]
    .filter(o=>o.marketFamily==="moneyline" && (o.period==="full_game" || o.period==="fg"));
  const poly=sources.filter(o=>(o.source==="Polymarket US"||o.source==="Polymarket US WebSocket") &&
    o.marketFamily==="moneyline" && (o.period==="full_game" || o.period==="fg") &&
    (marketDisplayImplied(o)!=null||o.raw?.marketState)).sort(currentFirst);
  const probabilities=modelProbabilities(game);
  const sides=sport==="soccer"?["away","draw","home"]:["away","home"];
  const rows=sides.map(side=>{
    const p=probabilities[side]??null;
    const pinQuote=pin.find(o=>resolveSide(o,game)===side);
    const polyQuote=poly.find(o=>resolveSide(o,game)===side);
    const polyP=polyQuote?marketDisplayImplied(polyQuote):null;
    return {
      side,label:side==="draw"?"Draw":game[side]?.name||game[side]?.fullName||side.toUpperCase(),
      pinnoddsAmerican:pinQuote?marketDisplayAmerican(pinQuote):null,
      pinnacleCapturedAt:pinQuote?.capturedAt||pinQuote?.collectedAt||null,
      polymarketProbability:polyP,
      polymarketAmerican:polyQuote?marketDisplayAmerican(polyQuote):null,
      polymarketObservedAt:polyQuote?.sourceObservedAt||polyQuote?.observedAt||null,
      polymarketSource:polyQuote?.source||null,
      polymarketQuoteKind:polyQuote?.quoteKind||null,
      polymarketIntelligence:assessPolymarketOffer(polyQuote,p,{...options,eventStart:game.start}),
      fbisProbability:p,
      fbisFairAmerican:p==null?null:contractPriceToAmerican(p),
    };
  });
  return {rows,hasPrices:rows.some(r=>r.pinnoddsAmerican!=null||r.polymarketProbability!=null||r.fbisProbability!=null),
    researchOnly:game?.canAuthorizeWager!==true,
    sport,projectionState:game?.projectionState||game?.projectionMaturity||game?.model?.maturity||null};
}
