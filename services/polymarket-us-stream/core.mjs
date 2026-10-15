/** Persistent US stream market selection & paced quote persistence controls. */
export const STREAM_SPORTS=Object.freeze(["nfl","cfb","cbb","nba","wnba","mlb","npb","kbo","nhl","soccer","tennis"]);
/** A six-hour, research-only REST contract roster can bootstrap signed WS
 * after a delayed hourly REST job. It NEVER refreshes REST quote timestamps.
 */
export const STREAM_CONTRACT_ROSTER_MAX_AGE_MS=6*60*60*1000;
export const STREAM_CONTRACT_ROSTER_FRESH_MS=35*60*1000;
export function streamContractRosterWindow(now=Date.now()){
 if(!Number.isFinite(now))throw Error("invalid-roster-clock");
 return {since:new Date(now-STREAM_CONTRACT_ROSTER_MAX_AGE_MS).toISOString(),
   freshSince:new Date(now-STREAM_CONTRACT_ROSTER_FRESH_MS).toISOString()};
}

export function fairMarketSelection(rows,{perSport=6,maxMarkets=48}={}){
  const seen=new Set(),groups=new Map(STREAM_SPORTS.map(s=>[s,[]]));
  for(const row of rows||[]){
    const slug=String(row?.source_market_id||"");
    if(!/^[a-z0-9-]{1,160}$/i.test(slug)||seen.has(slug))continue;
    const group=groups.get(String(row.sport||"").toLowerCase());
    if(!group)continue;seen.add(slug);group.push(row);
  }
  const result=[];
  // Reserve the six tennis contracts whenever they actually exist; across
  // eleven sports the original 48-slot round robin allocated tennis only four.
  // Other sports still receive >=4 when each has enough contracts (48 total).
  // No stale/expired market is created here: upstream candidates determine eligibility.
  if(maxMarkets>=STREAM_SPORTS.length*4 && perSport>=5){
    for(const item of (groups.get("tennis")||[]).slice(0,perSport)){
      if(result.length>=maxMarkets)break;
      result.push(item);
    }
  }
  for(let i=0;i<perSport&&result.length<maxMarkets;i++){
    for(const sport of STREAM_SPORTS){
      if(result.some(r=>r.source_market_id===groups.get(sport)?.[i]?.source_market_id))continue;
      const item=groups.get(sport)?.[i];
      if(item)result.push(item);
      if(result.length>=maxMarkets)break;
    }
  }
  return result;
}
export function shouldSaveBbo(current,last,{minIntervalMs=10000,minDelta=0.0025}={}){
  if(!current?.marketSlug||current.bestAsk==null&&current.bestBid==null)return false;
  if(!last)return true;
  if(current.marketState!==last.marketState)return true;
  if(current.timeMs-last.timeMs>=minIntervalMs)return true;
  for(const key of ["bestBid","bestAsk"]){
    if(current[key]!=null&&last[key]!=null&&Math.abs(current[key]-last[key])>=minDelta)return true;
  }
  return false;
}
export function liveBboOffer(tick,base){
  if(!tick||!base)return null;
  return {source:"Polymarket US WebSocket",sourceType:"exchange",
    sport:base.sport,league:base.league,eventId:base.canonical_event_id,
    eventStart:base.event_start_time,homeTeam:base.home_team,
    awayTeam:base.away_team,marketFamily:base.market_family,
    side:base.side,line:base.line,contractPrice:tick.marketState&&tick.marketState!=="MARKET_STATE_OPEN"?null:tick.bestAsk,
    standardOrAlt:"unknown",period:base.period||"unspecified",sourceMarketId:tick.marketSlug,
    sourceOutcomeId:base.source_outcome_id,fetchedAt:tick.at,
    executionEligible:false,canQualify:false,canAuthorizeWager:false,
    raw:{providerEventId:base.provider_event_id,providerMarketId:tick.marketSlug,
      providerOutcomeId:base.source_outcome_id,contractBindingVerified:true,contractLong:true,quoteKind:"WS_LIVE_BBO_UNVERIFIED_FILL",
      bestBid:tick.marketState&&tick.marketState!=="MARKET_STATE_OPEN"?null:tick.bestBid,bestAsk:tick.marketState&&tick.marketState!=="MARKET_STATE_OPEN"?null:tick.bestAsk,lastTrade:tick.lastTrade,
      bidDepth:tick.bidDepth,askDepth:tick.askDepth,
      sourceObservedAt:tick.sourceObservedAt||null,quoteObservedAt:tick.sourceObservedAt||null,marketObservedAt:tick.sourceObservedAt||null,marketState:tick.marketState||null,
      streamService:"fbis-polymarket-us-stream",streamMode:"RECONNECTING",
      canQualify:false,canAuthorizeWager:false,modelInfluence:"none"}};
}

/** Control frames never become price observations. */
export function parseStreamControl(raw){
 let value;try{value=typeof raw==="string"?JSON.parse(raw):raw}catch{return null}
 if(!value||typeof value!=="object")return null;
 if(Object.hasOwn(value,"error"))return{type:"error"};
 if(Object.hasOwn(value,"heartbeat"))return{type:"heartbeat"};
 return null;
}
export function streamIsHealthy({connected,lastMessageAt,now=Date.now(),maxAgeMs=120000}={}){
 return connected===true&&Number.isFinite(lastMessageAt)&&lastMessageAt>0&&now>=lastMessageAt&&now-lastMessageAt<=maxAgeMs;
}
/** A handshake timeout must stop once upgraded; aborting later kills the live socket. */
export async function fetchStreamUpgrade(url,options={}, {fetchImpl=fetch,timeoutMs=20000,timers={setTimeout,clearTimeout}}={}){
 const controller=new AbortController();
 const timeout=timers.setTimeout(()=>controller.abort(),timeoutMs);
 try{return await fetchImpl(url,{...options,signal:controller.signal});}
 finally{timers.clearTimeout(timeout);}
}
