const clean=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const surname=s=>clean(s).split(" ").at(-1)||"";
const playerMatch=(label,player)=>{
 const a=clean(label),b=clean(player);
 return a===b||(surname(player).length>=5&&a.split(" ").includes(surname(player)));
};
const matchedWinner=(name,players)=>{
 const hits=players.map(p=>playerMatch(name,p));
 return hits.filter(Boolean).length===1?hits.indexOf(true):-1;
};
/** Read-only evidence comparison. No derived edge/EV or wager authority.
 * A provider quote from a set/game/handicap must never be compared against
 * a match-winner contract, even if it names the same athletes.
 */
export function compareTennisExchangeResearch(players,kalshi=[],polymarket=[]){
 if(!Array.isArray(players)||players.length!==2||players.some(p=>!p))return [];
 const matches=[];
 for(const pm of polymarket){
  if(!pm?.question||pm.outcomes?.length!==2||pm.researchClob?.sides?.length!==2)continue;
  if(/set\s*\d|set winner|set handicap|game spread|total|games|handicap|tiebreak/i.test(pm.question))continue;
  const indexes=pm.outcomes.map(o=>matchedWinner(o,players));
  if(indexes[0]<0||indexes[1]<0||indexes[0]===indexes[1])continue;
  for(const k of kalshi){
   if(!k?.yesLabel||k.yesAskDollars==null)continue;
   if(/set\s*\d|set winner|set handicap|game spread|total|games|handicap|tiebreak/i.test(k.title||""))continue;
   const index=matchedWinner(k.yesLabel,players);
   if(index<0)continue;
   const polyIndex=indexes.indexOf(index);
   const price=Number(pm.researchClob.sides[polyIndex]?.bestAsk?.price);
   const kalshiAsk=Number(k.yesAskDollars);
   if(!(price>0&&price<1&&kalshiAsk>0&&kalshiAsk<1))continue;
   const kalshiCaptureAt=k.fetchedAt||null,polyCaptureAt=pm.researchClob.observedAt||pm.capturedAt||null;
   const times=[Date.parse(kalshiCaptureAt||""),Date.parse(polyCaptureAt||"")];
   const captureSkewMinutes=times.every(Number.isFinite)?Math.round(Math.abs(times[0]-times[1])/60000):null;
   const scheduleConflict=[k.scheduleStatus,pm.scheduleStatus].some(z=>z&&z!=="START_WITHIN_TWO_HOURS");
   const extreme=kalshiAsk<=.01||kalshiAsk>=.99||price<=.01||price>=.99;
   const integrityWarnings=[
    ...(scheduleConflict?["SCHEDULE_DISCREPANCY"]:[]),
    ...(extreme?["EXTREME_INDICATIVE_PRICE"]:[]),
    ...(captureSkewMinutes==null||captureSkewMinutes>15?["CAPTURE_TIMES_DIFFER_OR_UNKNOWN"]:[]),
    "SOURCE_QUOTE_CLOCK_UNVERIFIED","FEES_AND_FILLABILITY_UNVERIFIED"
   ];
   const kalshiSize=Number(k.yesAskSize),polySize=Number(pm.researchClob.sides[polyIndex]?.bestAsk?.size);
   matches.push({player:players[index],kalshiAsk,polymarketAsk:price,
    kalshiAskSize:Number.isFinite(kalshiSize)&&kalshiSize>0?kalshiSize:null,
    polymarketAskSize:Number.isFinite(polySize)&&polySize>0?polySize:null,
    observedKalshiAt:kalshiCaptureAt,observedPolymarketAt:polyCaptureAt,
    captureSkewMinutes,kalshiScheduleStatus:k.scheduleStatus||"UNKNOWN",
    polymarketScheduleStatus:pm.scheduleStatus||"UNKNOWN",integrityWarnings,
    kalshiTicker:k.ticker,polymarketEvent:pm.eventSlug,
    source:"DUAL_EXCHANGE_RESEARCH_ONLY",canQualify:false,canAuthorizeWager:false,
    feesKnown:false,fillable:false,edgeCalculated:false});
  }
 }
 return matches.slice(0,4);
}
