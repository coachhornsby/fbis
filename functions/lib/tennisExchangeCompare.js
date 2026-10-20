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
   matches.push({player:players[index],kalshiAsk,polymarketAsk:price,
    observedKalshiAt:k.fetchedAt||null,observedPolymarketAt:pm.researchClob.observedAt||pm.capturedAt||null,
    kalshiTicker:k.ticker,polymarketEvent:pm.eventSlug,
    source:"DUAL_EXCHANGE_RESEARCH_ONLY",canQualify:false,canAuthorizeWager:false,
    feesKnown:false,fillable:false,edgeCalculated:false});
  }
 }
 return matches.slice(0,4);
}
