/** Persistent US stream market selection & paced quote persistence controls. */
export const STREAM_SPORTS=Object.freeze(["nfl","cfb","cbb","nba","wnba","mlb","npb","kbo","nhl","soccer","tennis"]);
export function fairMarketSelection(rows,{perSport=6,maxMarkets=48}={}){
  const seen=new Set(),groups=new Map(STREAM_SPORTS.map(s=>[s,[]]));
  for(const row of rows||[]){
    const slug=String(row?.source_market_id||"");
    if(!/^[a-z0-9-]{1,160}$/i.test(slug)||seen.has(slug))continue;
    const group=groups.get(String(row.sport||"").toLowerCase());
    if(!group)continue;seen.add(slug);group.push(row);
  }
  const result=[];
  for(let i=0;i<perSport&&result.length<maxMarkets;i++){
    for(const sport of STREAM_SPORTS){
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
    side:base.side,line:base.line,contractPrice:tick.bestAsk,
    standardOrAlt:"unknown",period:"full_game",sourceMarketId:tick.marketSlug,
    sourceOutcomeId:base.source_outcome_id,fetchedAt:null,
    executionEligible:false,canQualify:false,canAuthorizeWager:false,
    raw:{providerEventId:base.provider_event_id,providerMarketId:tick.marketSlug,
      providerOutcomeId:base.source_outcome_id,quoteKind:"WS_LIVE_BBO_UNVERIFIED_FILL",
      bestBid:tick.bestBid,bestAsk:tick.bestAsk,lastTrade:tick.lastTrade,
      bidDepth:tick.bidDepth,askDepth:tick.askDepth,
      collectorCapturedAt:tick.at,sourceObservedAt:null,quoteObservedAt:null,marketObservedAt:null,
      streamService:"fbis-polymarket-us-stream",streamMode:"RECONNECTING",
      canQualify:false,canAuthorizeWager:false,modelInfluence:"none"}};
}
