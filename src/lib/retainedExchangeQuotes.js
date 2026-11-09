// Presentation-only retention. Never feeds the model, recommendations or wagers.
const retainedStates=Symbol('retainedMarketStates');
const stopped=new Set(['closed','settled','cancelled','canceled','invalid','unavailable','inactive','suspended']);
export const exchangeObservationTime=q=>Date.parse(q?.stateObservedAt||q?.statusObservedAt||q?.receivedAt||'');
export function exchangeMarketState(q){
 const raw=String(q?.marketStatus||q?.status||'').toLowerCase();
 if(stopped.has(raw))return ['closed','settled','cancelled','canceled'].includes(raw)?'closed':'unavailable';
 return q?.displayEligible===false||q?.invalid===true?'unavailable':'observed';
}
const identity=q=>q&&typeof q==='object'&&typeof q.venue==='string'&&typeof q.side==='string'
 ?JSON.stringify([q.venue,q.marketFamily||'moneyline',q.period||'game',q.side,q.marketId||null,q.marketId?null:q.line??null,q.eventStart||null]):null;
export function mergeRetainedExchangeQuotes(previous={},incoming={},now=Date.now(),unavailableMarkets=[]){
 const states=new Map(previous?.[retainedStates]||[]);
 for(const t of unavailableMarkets||[]){
  const at=exchangeObservationTime(t);
  if(!t||typeof t.venue!=='string'||typeof t.marketId!=='string'||!Number.isFinite(at)||at>now)continue;
  const key=JSON.stringify([t.venue,t.marketId]),old=states.get(key);
  if(!old||at>exchangeObservationTime(old))states.set(key,{...t,marketStatus:t.marketStatus||'unavailable'});
 }
 const result=Object.create(null);
 for(const [eventId,rows] of Object.entries(previous||{}))if(Array.isArray(rows))result[eventId]=rows;
 for(const [eventId,rows] of Object.entries(incoming||{})){
  if(!Array.isArray(rows))continue;
  const merged=new Map();
  for(const q of result[eventId]||[]){const key=identity(q);if(key)merged.set(key,q);}
  for(const q of rows){
   const key=identity(q),at=exchangeObservationTime(q);
   if(!key||!Number.isFinite(at)||at>now)continue;
   const old=merged.get(key),prior=exchangeObservationTime(old);
   // At the same observation time a closed/invalid state wins; a price cannot
   // resurrect that contract without a genuinely newer observation.
   if(!old||at>prior||(at===prior&&exchangeMarketState(q)!=='observed'&&exchangeMarketState(old)==='observed'))
    merged.set(key,{...q,canAuthorizeWager:false,executionEligible:false,canQualify:false,referenceOnly:true});
   else if(at===prior&&exchangeMarketState(q)==='observed'&&exchangeMarketState(old)==='observed'&&typeof q.ask==='number'&&q.ask>0&&q.ask<1&&
    ['ask','receivedAt','sourceObservedAt','providerObservedAt','observedAt','sourceOutcomeId','line','transport','quoteKind','priceDerivation'].every(field=>q[field]===old[field])){
    // Same observation may carry corrected display freshness, never a new price,
    // identity, source clock, or market state. Tombstones still apply below.
    const flags={};for(const field of ['stale','fresh'])if(typeof q[field]==='boolean')flags[field]=q[field];
    merged.set(key,{...old,...flags,canAuthorizeWager:false,executionEligible:false,canQualify:false,referenceOnly:true});
   }
  }
  result[eventId]=[...merged.values()];
 }
 for(const [id,rows] of Object.entries(result))result[id]=rows.map(q=>{
  const state=states.get(JSON.stringify([q.venue,q.marketId]));
  return state&&exchangeObservationTime(state)>=exchangeObservationTime(q)?{...q,marketStatus:state.marketStatus,statusObservedAt:state.stateObservedAt||state.receivedAt,displayEligible:false,canAuthorizeWager:false,executionEligible:false}:q;
 });
 Object.defineProperty(result,retainedStates,{value:states});
 return result;
}

const cachePrefix='fbis:exchange-reference:v1:';
const maxCacheBytes=1048576;
const safeScope=scope=>/^(?:cfb|nfl|nba|cbb|nhl)\|\d{4}-\d{2}-\d{2}$/.test(scope||'');
export function loadRetainedExchangeQuotes(storage,scope,now=Date.now()){
 try{
  if(!safeScope(scope))return {};
  const raw=storage?.getItem(cachePrefix+scope);if(!raw||raw.length>maxCacheBytes)return {};
  const p=JSON.parse(raw);if(p?.version!==1||p.scope!==scope||!p.byEvent||typeof p.byEvent!=='object'||Array.isArray(p.byEvent)||Object.keys(p.byEvent).length>500)return {};
  let count=0;const clean=Object.create(null);
  for(const [id,rows] of Object.entries(p.byEvent)){
   if(id.length>160||!Array.isArray(rows))return {};
   clean[id]=rows.filter(q=>{count++;return q&&['Kalshi','Polymarket'].includes(q.venue)&&typeof q.side==='string'&&q.side.length<48&&typeof q.eventStart==='string'&&Number.isFinite(Date.parse(q.eventStart))&&Number.isFinite(exchangeObservationTime(q))&&exchangeObservationTime(q)<=now&&(!q.marketId||typeof q.marketId==='string'&&q.marketId.length<=180)&&(exchangeMarketState(q)!=='observed'||typeof q.ask==='number'&&q.ask>0&&q.ask<1);});
  }
  if(count>5000||!Array.isArray(p.unavailableMarkets)||p.unavailableMarkets.length>5000)return {};
  return mergeRetainedExchangeQuotes({},clean,now,p.unavailableMarkets);
 }catch{return {};}
}
export function saveRetainedExchangeQuotes(storage,scope,byEvent,now=Date.now()){
 try{
  if(!storage||!safeScope(scope))return false;
  const raw=JSON.stringify({version:1,scope,savedAt:now,byEvent,unavailableMarkets:[...(byEvent?.[retainedStates]||new Map()).values()]});
  if(raw.length>maxCacheBytes)return false;
  storage.setItem(cachePrefix+scope,raw);
  // Bound tab-local persistence to six sport/date scopes; no server writes.
  const keys=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(cachePrefix))keys.push(key);}
  keys.sort((a,b)=>{try{return JSON.parse(storage.getItem(a)).savedAt-JSON.parse(storage.getItem(b)).savedAt;}catch{return 0;}});
  while(keys.length>6)storage.removeItem(keys.shift());
  return true;
 }catch{return false;}
}
