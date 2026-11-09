import {POLY_US_API,marketEventStart,polymarketUsMarketFamily,polymarketUsPeriod} from '../../functions/lib/polymarketUs.js';

// Public US documentation, not the International Gamma/CLOB API:
// https://docs.polymarket.us/api-reference/oapi-schemas/markets-schema.json
// Market responses have no documented parent event link. Only source-authored
// membership from the independently matched list event can authorize attachment.
const textId=value=>typeof value==='string'&&value.length>0&&value.length<=160?value:Number.isSafeInteger(value)&&value>0?String(value):null;
const slug=value=>typeof value==='string'&&/^[a-z0-9-]{1,160}$/i.test(value)?value:null;
const numericId=value=>/^[1-9][0-9]{0,9}$/.test(String(value))&&Number(value)<=2147483647?String(value):null;
const types=['SPORTS_MARKET_TYPE_MONEYLINE','SPORTS_MARKET_TYPE_SPREAD','SPORTS_MARKET_TYPE_TOTAL'];
const mismatch=()=>{throw Error('PROVIDER_MARKET_ANCHOR_CONFLICT');};

export function anchoredMarketPlan(event,{rotation=0}={}){
 if(!Number.isInteger(event?.gameId)||!numericId(event.gameId)||!textId(event.id)||!slug(event.slug))return null;
 if(!Array.isArray(event.markets)||event.markets.length>200)return null;
 if(event.eventState?.gameId!=null&&String(event.eventState.gameId)!==String(event.gameId))mismatch();
 if(event.eventState?.eventId!=null&&String(event.eventState.eventId)!==String(event.id))mismatch();
 const byId=new Map(),bySlug=new Map();
 for(const market of event.markets){
  const id=textId(market?.id),key=slug(market?.slug);
  if(id&&byId.has(id)||key&&bySlug.has(key))mismatch();
  if(id)byId.set(id,market);
  if(key)bySlug.set(key,market);
 }
 // Bound membership inspection too. Oversized/unsupported anchor inventory
 // does not relax the 200-market boundary; the original detail path remains.
 const groups=event.marketGroups??[];
 if(!Array.isArray(groups)||groups.length>200)return null;
 let references=0;
 for(const group of groups){
  if(!Array.isArray(group?.marketIds)||references+group.marketIds.length>200)return null;
  references+=group.marketIds.length;
  for(const value of group.marketIds){const id=textId(value);if(!id)return null;if(!byId.has(id))byId.set(id,null);}
  if(byId.size>200)return null;
 }
 // Never mix ID and slug filters: their intersection/union behavior is not
 // documented. Numeric IDs use the documented int32 filter; otherwise use
 // exact slugs already embedded in the matched event.
 const ids=[...byId.keys()].filter(id=>numericId(id));
 const mode=ids.length?'id':'slug',keys=(ids.length?ids:[...bySlug.keys()]).sort();
 if(!keys.length)return null;
 const offset=(Math.max(0,Math.floor(rotation))*24)%keys.length;
 const requested=[...keys.slice(offset),...keys.slice(0,offset)].slice(0,24);
 const url=new URL('/v1/markets',POLY_US_API);
 // Exact source IDs/slugs already constrain membership. Keep gameId as a
 // source/response identity check, not a redundant server-side intersection.
 url.searchParams.set('limit','24');url.searchParams.set('offset','0');
 for(const type of types)url.searchParams.append('sportsMarketTypes',type);
 for(const key of requested)url.searchParams.append(mode,key);
 return {url,event,mode,requested,byId,bySlug};
}

export function validateAnchoredMarketUrl(url,plan){
 const value=new URL(url);
 if(!plan||value.toString()!==plan.url.toString()||value.origin!==POLY_US_API||value.pathname!=='/v1/markets'||value.username||value.password||value.hash)throw Error('PROVIDER_MARKET_QUERY_NOT_APPROVED');
 return value;
}

export function anchoredMarketEvent(value,plan){
 if(!plan||!Array.isArray(value?.markets)||value.markets.length>24)throw Error('PROVIDER_MARKET_PAGE_INVALID');
 const requested=new Set(plan.requested),ids=new Set(),slugs=new Set();
 const event=plan.event;
 // Validate the ENTIRE optional result before returning an event for existing
 // binding/quote logic. No partially accepted markets or mutations on failure.
 for(const market of value.markets){
  const id=textId(market?.id),key=slug(market?.slug);
  if(!id||!key||!requested.has(plan.mode==='id'?id:key)||ids.has(id)||slugs.has(key))mismatch();
  ids.add(id);slugs.add(key);
  const known=plan.mode==='id'?plan.byId.get(id):plan.bySlug.get(key);
  if(known?.id!=null&&String(known.id)!==id||known?.slug!=null&&known.slug!==key)mismatch();
  const sameSlug=plan.bySlug.get(key);
  if(sameSlug?.id!=null&&String(sameSlug.id)!==id)mismatch();
  // A supplied conflicting relationship is fatal, even though these parent
  // fields are not guaranteed by the public market response schema.
  if(market.eventId!=null&&String(market.eventId)!==String(event.id)||
   market.gameId!=null&&String(market.gameId)!==String(event.gameId)||
   market.eventSlug!=null&&market.eventSlug!==event.slug)mismatch();
  if(market.gameStartTime!=null&&Date.parse(market.gameStartTime)!==Date.parse(marketEventStart(event)))mismatch();
  const family=polymarketUsMarketFamily(market);
  if(!['moneyline','spread','total'].includes(family))mismatch();
  if(known&&(polymarketUsMarketFamily(known)!==family||polymarketUsPeriod(known)!==polymarketUsPeriod(market)||
   known.line!=null&&Number(known.line)!==Number(market.line)))mismatch();
  if(!Array.isArray(market.marketSides)||market.marketSides.length>4)throw Error('PROVIDER_SIDE_CAPACITY');
  const sides=new Map();
  for(const side of market.marketSides){
   const sideId=textId(side?.id);
   if(!sideId||sides.has(sideId)||side.marketId!=null&&String(side.marketId)!==id)mismatch();
   sides.set(sideId,side);
  }
  for(const old of known?.marketSides||[]){
   const side=sides.get(textId(old.id));
   if(!side||['long','description','teamId','identifier'].some(field=>old[field]!=null&&old[field]!==side[field])||
    old.team?.name!=null&&old.team.name!==side.team?.name)mismatch();
  }
 }
 // The parent is carried over only after exact provider membership checks.
 // Existing fixture matching and complementary-side validation still run.
 return {...event,markets:value.markets};
}
