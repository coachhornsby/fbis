/**
 * Source-bound exchange navigation only. A URL never verifies price,
 * settlement equivalence, independent model quality or wagering permission.
 *
 * Kalshi exposes a ticker-addressable market route. Polymarket Global exposes
 * a documented event-slug route (not a guaranteed selected contract). For
 * Polymarket US use ONLY a provider-supplied exact-market link: US and Global
 * are different exchanges and slug formats are not interchangeable.
 */
const tickerPattern=/^KX[A-Z0-9_.]{2,90}-[A-Z0-9_.-]{2,120}$/i;
const slugPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const nonEmpty=value=>typeof value==='string'&&value.trim()?value.trim():null;

// Kalshi uses /markets/SERIES/CATEGORY/EVENT?op_market_ticker=MARKET,
// not /markets/MARKET. Only series with independently observed public
// category paths may be constructed; any sport may use a source-supplied URL.
const KALSHI_VERIFIED_SERIES_CATEGORIES=Object.freeze({
 KXATPMATCH:'atp-tennis-match',
 KXNBAGAME:'nba-game',
 KXNHLGAME:'nhl-game',
});
function kalshiMarketDestination(offer,ticker){
 const event=nonEmpty(offer.eventTicker)||nonEmpty(offer.providerEventTicker)||
  nonEmpty(offer.raw?.eventTicker)||nonEmpty(offer.raw?.event_ticker);
 const provided=nonEmpty(offer.marketUrl)||nonEmpty(offer.sourceMarketUrl)||
  nonEmpty(offer.raw?.marketUrl)||nonEmpty(offer.raw?.providerMarket?.url);
 if(provided){
  try {
   const uri=new URL(provided);
   if(uri.protocol!=='https:'||!['kalshi.com','www.kalshi.com'].includes(uri.hostname)||
      uri.username||uri.password||uri.port)return null;
   // Provider URL must identify this exact contract, not just the sport.
   const selected=uri.searchParams.get('op_market_ticker');
   if(selected?.toUpperCase()!==ticker.toUpperCase())return null;
   return uri.toString();
  }catch{return null;}
 }
 if(!event||!/^KX[A-Z0-9_.]{2,90}-[A-Z0-9_.-]{2,120}$/i.test(event+'-X')||
   !ticker.toUpperCase().startsWith(event.toUpperCase()+'-'))return null;
 const series=event.split('-')[0].toUpperCase();
 const category=KALSHI_VERIFIED_SERIES_CATEGORIES[series];
 if(!category)return null;
 return 'https://kalshi.com/markets/'+series.toLowerCase()+'/'+category+'/'
  +event.toLowerCase()+'?op_market_ticker='+encodeURIComponent(ticker);
}


export function exchangeMarketLink(offer={}){
 if(!offer||typeof offer!=='object')return null;
 const provider=String(offer.source||offer.provider||offer.book||'').toLowerCase();
 const venue=String(offer.venue||'').toLowerCase();
 const ticker=nonEmpty(offer.providerTicker)||nonEmpty(offer.ticker)||
    nonEmpty(offer.sourceMarketId)||nonEmpty(offer.contractId);
 if(provider.includes('kalshi')){
  if(!ticker||!tickerPattern.test(ticker))return null;
  const url=kalshiMarketDestination(offer,ticker);
  if(!url)return null;
  return {url,provider:'Kalshi',scope:'MARKET',id:ticker,label:'Open on Kalshi'};
 }
 const isGlobal=venue.includes('global')||provider.includes('global')||
   provider.includes('gamma')||provider.includes('clob');
 const isUS=venue.includes('us')||provider.includes('polymarket us')||
   provider.includes('polymarket us websocket');
 if(isGlobal){
  const eventSlug=nonEmpty(offer.providerEventSlug)||nonEmpty(offer.eventSlug)||
   nonEmpty(offer.raw?.eventSlug)||nonEmpty(offer.raw?.providerEventSlug);
  if(!eventSlug||!slugPattern.test(eventSlug))return null;
  return {url:'https://polymarket.com/event/'+eventSlug,
   provider:'Polymarket Global',scope:'EVENT',id:eventSlug,label:'View on Polymarket'};
 }
 if(isUS){
  const marketId=nonEmpty(offer.sourceMarketId)||nonEmpty(offer.contractId)||
   nonEmpty(offer.raw?.providerMarketId);
  const candidate=nonEmpty(offer.marketUrl)||nonEmpty(offer.raw?.providerMarket?.marketUrl)||
    nonEmpty(offer.raw?.providerMarket?.url);
  if(!marketId||!candidate)return null;
  try{
   const uri=new URL(candidate);
   if(uri.protocol!=='https:'||uri.hostname!=='polymarket.us'||
      uri.username||uri.password||uri.port)return null;
   // Exact-market evidence is required. Event-only URLs are not accepted.
   const parts=uri.pathname.split('/').filter(Boolean).map(decodeURIComponent);
   const queryIds=['market','marketId','market_id','slug'].map(k=>uri.searchParams.get(k));
   const pathMatches=parts.some(x=>x===marketId) &&
     parts.some(x=>/^(?:market|markets|contract|contracts)$/i.test(x));
   const queryMatches=queryIds.some(x=>x===marketId);
   if(!pathMatches&&!queryMatches)return null;
   return {url:uri.toString(),provider:'Polymarket US',scope:'MARKET',id:marketId,
    label:'Open on Polymarket US'};
  }catch{return null;}
 }
 return null;
}

export function exchangeLinksForGame(game={}){
 const venueOffers=Array.isArray(game?.market?.venueOffers)?game.market.venueOffers:[];
 const tennis=game?.tennisProjection||{};
 const sources=[...venueOffers,
  ...(Array.isArray(tennis.venueOffers)?tennis.venueOffers:[]),
  ...(Array.isArray(game?.market?.reference?.venueOffers)?game.market.reference.venueOffers:[]),
  ...(Array.isArray(tennis.kalshiResearchOffers)?tennis.kalshiResearchOffers.map(o=>({...o,source:'Kalshi',providerTicker:o.ticker,marketFamily:o.marketFamily||'moneyline'})):[]),
  ...(Array.isArray(tennis.polymarketGlobalOffers)?tennis.polymarketGlobalOffers.map(o=>({...o,source:'Polymarket Global Gamma',venue:'Polymarket Global',providerEventSlug:o.eventSlug,marketFamily:o.marketFamily||'moneyline'})):[])
 ];
 const links=new Map();
 for(const row of sources){
  const link=exchangeMarketLink(row);
  if(!link)continue;
  const family=String(row.marketFamily||row.canonical_market||'market').replaceAll('_',' ');
  const side=String(row.side||row.yesLabel||row.participantName||'').trim();
  const line=row.line==null?'':String(row.line);
  const key=link.provider+'|'+link.id;
  if(!links.has(key))links.set(key,{...link,
    description:[family,side,line].filter(Boolean).join(' · ')});
 }
 return [...links.values()];
}
