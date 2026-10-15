import {marketDisplayAmerican} from "./marketQuoteDisplay.js";

const BASKETBALL_FOOTBALL = new Set(["cfb","nfl","cbb","nba","wnba"]);
const HOCKEY_BASEBALL = new Set(["nhl","mlb","npb","kbo"]);
const SIDES = {spread:["away","home"],total:["over","under"],moneyline:["away","home"]};
const num = value => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const date = value => {const n=Date.parse(value||""); return Number.isFinite(n)?n:0;};
const standard = quote => /^(standard|primary|main)$/.test(String(quote.standardOrAlt??quote.standard_or_alt??"").toLowerCase());
const fullGame = quote => !quote.period || ["full_game","fg"].includes(String(quote.period).toLowerCase());

export function pinnoddsMarketOrder(sport) {
  const s=String(sport||"").toLowerCase();
  if(BASKETBALL_FOOTBALL.has(s))return ["spread","total"];
  if(HOCKEY_BASEBALL.has(s))return ["total","spread"];
  return [];
}

function selectFamily(offers,family) {
  const sides=SIDES[family], groups=new Map();
  for(const quote of offers) {
    if(quote.marketFamily!==family || !fullGame(quote) || !sides.includes(String(quote.side).toLowerCase()))continue;
    const american=marketDisplayAmerican(quote);
    const line=family==="moneyline"?null:num(quote.line);
    if(american==null || (family!=="moneyline" && line==null))continue;
    const side=String(quote.side).toLowerCase();
    // A spread must pair opposite, signed lines. Totals must pair the same number.
    const marketKey=family==="moneyline"?"ML":family==="spread"?String(Math.abs(line)):String(line);
    const id=quote.sourceMarketId||quote.source_market_id||"";
    const key=[family,marketKey,id].join("|");
    if(!groups.has(key))groups.set(key,{family,key,marketKey,quotes:{},sourceMarketId:id});
    const group=groups.get(key),candidate={...quote,side,line,american,stamp:date(quote.capturedAt||quote.collectedAt)};
    const previous=group.quotes[side];
    if(!previous || candidate.stamp>previous.stamp || (candidate.stamp===previous.stamp && standard(candidate) && !standard(previous)))group.quotes[side]=candidate;
  }
  const complete=[];
  for(const group of groups.values()) {
    const a=group.quotes[sides[0]],b=group.quotes[sides[1]];
    if(!a || !b)continue;
    if(family==="spread" && Math.abs(a.line+b.line)>0.00001)continue;
    if(family==="total" && Math.abs(a.line-b.line)>0.00001)continue;
    // Opposite sides observed in different collection batches are not a coherent price pair.
    if(a.stamp && b.stamp && Math.abs(a.stamp-b.stamp)>60_000)continue;
    const namedMain=standard(a)&&standard(b);
    const pricedNearEven=Math.abs((a.decimalOdds??1+100/Math.abs(a.american))-1.91)+Math.abs((b.decimalOdds??1+100/Math.abs(b.american))-1.91);
    complete.push({family,marketKey:group.marketKey,primaryVerified:namedMain,
      providerMainUnverified:!namedMain,quotes:[a,b],
      stamp:Math.max(a.stamp,b.stamp),score:pricedNearEven});
  }
  complete.sort((a,b)=>Number(b.primaryVerified)-Number(a.primaryVerified)||a.score-b.score||b.stamp-a.stamp);
  return complete[0]||null;
}

/** Display-only. Never infers book-designated main lines, executable prices, or model edge. */
export function selectPinnoddsGameMarkets(game={}) {
  const research=Array.isArray(game?.pinnoddsResearch?.offers)?game.pinnoddsResearch.offers:[];
  const venue=Array.isArray(game?.market?.venueOffers)?game.market.venueOffers.filter(q=>q.source==="PinnOdds"):[];
  const offers=[...research,...venue].filter(q=>q && (!q.source || q.source==="PinnOdds"));
  const families={};
  for(const family of ["spread","total","moneyline"])families[family]=selectFamily(offers,family);
  return {families,order:pinnoddsMarketOrder(game.sport),
    capturedAt:game?.pinnoddsResearch?.latestCapturedAt||null,
    researchOnly:true};
}
