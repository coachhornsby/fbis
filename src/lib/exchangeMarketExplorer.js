/**
 * Presentation-only exchange inventory for an exact FBIS game ID.
 * Never turns reference captures into executable or qualified betting lines.
 */
const supported=new Set(['Kalshi','Polymarket','Polymarket US']);
const marketFamily=x=>x==='moneyline'?'Moneyline':x==='spread'?'Spread':x==='total'?'Total':x==='team_total'?'Team total':String(x||'Unclassified').replaceAll('_',' ');
const toPeriod=x=>['1h','first_half','1st_half'].includes(String(x||'').toLowerCase())?'1h':'game';
const valid=x=>typeof x==='number'&&Number.isFinite(x)&&x>0&&x<1;
export function americanFromContractCost(price){
 if(!valid(price))return null;
 return price<0.5?Math.round(100*(1-price)/price):Math.round(-100*price/(1-price));
}
export function formatAmericanFromCost(price){
 const x=americanFromContractCost(price);
 return x==null?'Quote unavailable':x>0?'+'+x:String(x);
}
export function exchangeGameMarkets(payload,game,{now=Date.now()}={}){
 if(payload?.ok!==true||payload?.referenceOnly!==true||payload?.canAuthorizeWager!==false||
    !game?.id||!Array.isArray(payload.byEvent?.[game.id]))return [];
 return payload.byEvent[game.id].filter(o=>supported.has(o?.venue)&&
  ['moneyline','spread','total','team_total'].includes(o.marketFamily)&&
  typeof o.side==='string'&&o.side.length>0&&o.side.length<48&&
  (o.line==null||typeof o.line==='number'&&Number.isFinite(o.line))&&valid(o.ask)&&
  o.canAuthorizeWager===false&&
  Number.isFinite(Date.parse(o.receivedAt||''))&&Date.parse(o.receivedAt)<=now)
  .slice(0,600).map((o,i)=>{
   const period=toPeriod(o.period);
   const ageSeconds=Math.floor((now-Date.parse(o.receivedAt))/1000);
   const maxAgeSeconds=o.transport==='WebSocket'?120:900;
   return {id:[o.venue,o.marketId,o.side,o.line,period,i].join('|'),
    venue:o.venue==='Polymarket'?'Polymarket US':o.venue,period,
    family:o.marketFamily,familyLabel:marketFamily(o.marketFamily),side:o.side,
    line:o.line??null,cost:o.ask,american:americanFromContractCost(o.ask),
    receivedAt:o.receivedAt,ageSeconds,
    status:ageSeconds<=maxAgeSeconds?'CAPTURED':'STALE',
    transport:o.transport||'UNKNOWN',marketId:o.marketId||null,
    providerTimestampVerified:o.providerTimestampVerified===true,
    canAuthorizeWager:false};
  }).sort((a,b)=>a.period.localeCompare(b.period)||a.family.localeCompare(b.family)||
   (a.line??0)-(b.line??0)||a.venue.localeCompare(b.venue)||a.side.localeCompare(b.side));
}
export function marketCoverageStatus(payload,{venue,period}){
 if(!payload?.ok)return 'FEED_UNAVAILABLE';
 const root=venue==='Kalshi'?payload.marketSources?.Kalshi:payload.marketSources?.Polymarket;
 if(!root)return 'NOT_CAPTURED';
 if(venue==='Kalshi'){
  const relevant=period==='1h'?[root.first_half_total]:[root.moneyline,root.spread,root.total,root.team_total];
  const states=relevant.filter(Boolean).map(x=>x.state);
  return !states.length||states.every(x=>x==='NOT_CAPTURED')?'NOT_CAPTURED':states.some(x=>x==='CAPTURED')?'PARTIAL_CAPTURE':states[0]||'NOT_CAPTURED';
 }
 return root.state==='CAPTURED'?'CAPTURED_INVENTORY_PARTIAL':root.state||'NOT_CAPTURED';
}
