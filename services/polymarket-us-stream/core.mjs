/** Persistent US stream: fair capacity management, paced quote persistence. */
export const STREAM_SPORTS=Object.freeze(["nfl","cfb","cbb","nba","wnba","mlb","npb","kbo","nhl","soccer","tennis"]);
/** A bounded 72-hour, research-only REST contract roster can bootstrap signed WS
 * after an overnight database outage interrupts hourly discovery. It NEVER refreshes REST quote timestamps.
 */
export const STREAM_CONTRACT_ROSTER_MAX_AGE_MS=72*60*60*1000;
export const STREAM_CONTRACT_ROSTER_FRESH_MS=35*60*1000;

/**
 * Operational capacity controls — NOT confirmed exchange hard limits.
 * Polymarket US subscribe frames in this codebase are batched at 50 slugs;
 * total capacity scales by sending multiple subscribe batches (and optional
 * extra connections) under one Durable Object owner.
 */
export const STREAM_SUBSCRIBE_BATCH_MAX=50;
export const STREAM_DEFAULT_MAX_CONTRACTS=500;
export const STREAM_DEFAULT_MAX_PER_CONNECTION=50;
export const STREAM_DEFAULT_MIN_PER_SPORT=1;

export function streamContractRosterWindow(now=Date.now()){
 if(!Number.isFinite(now))throw Error("invalid-roster-clock");
 return {since:new Date(now-STREAM_CONTRACT_ROSTER_MAX_AGE_MS).toISOString(),
   freshSince:new Date(now-STREAM_CONTRACT_ROSTER_FRESH_MS).toISOString()};
}

export function resolveStreamCapacity(env={}){
  const num=(v,fallback)=>{
    const n=Number(v);
    return Number.isFinite(n)&&n>0?Math.floor(n):fallback;
  };
  const maxPerConnection=Math.min(
    STREAM_SUBSCRIBE_BATCH_MAX,
    num(env.STREAM_MAX_PER_CONNECTION,STREAM_DEFAULT_MAX_PER_CONNECTION)
  );
  const maxContracts=num(env.STREAM_MAX_CONTRACTS,STREAM_DEFAULT_MAX_CONTRACTS);
  const maxConnections=Math.max(1,num(env.STREAM_MAX_CONNECTIONS,
    Math.ceil(maxContracts/Math.max(1,maxPerConnection))));
  return {
    maxContracts,
    maxPerConnection,
    maxConnections,
    minPerSport:Math.max(0,num(env.STREAM_MIN_PER_SPORT,STREAM_DEFAULT_MIN_PER_SPORT)),
    subscribeBatchMax:STREAM_SUBSCRIBE_BATCH_MAX,
    source:"env-or-default",
    note:"Soft operational ceilings; not a verified Polymarket hard quota.",
  };
}

/** Deduplicate eligible contracts by source_market_id; keep newest collected_at. */
export function dedupeEligibleContracts(rows=[]){
  const seen=new Map();
  for(const row of rows||[]){
    const slug=String(row?.source_market_id||"");
    if(!/^[a-z0-9-]{1,160}$/i.test(slug))continue;
    const sport=String(row.sport||"").toLowerCase();
    if(!STREAM_SPORTS.includes(sport))continue;
    const prev=seen.get(slug);
    if(!prev||String(row.collected_at||"")>String(prev.collected_at||"")){
      seen.set(slug,{...row,sport,source_market_id:slug});
    }
  }
  return [...seen.values()];
}

/**
 * Fair round-robin assignment across all 11 sports up to capacity.
 * Large single-sport slates cannot silently starve another sport.
 * Returns assigned contracts, uncovered with reasons, and connection partitions.
 */
export function manageSubscriptionCapacity(rows,{
  maxContracts=STREAM_DEFAULT_MAX_CONTRACTS,
  maxPerConnection=STREAM_DEFAULT_MAX_PER_CONNECTION,
  maxConnections=null,
  minPerSport=STREAM_DEFAULT_MIN_PER_SPORT,
  sports=STREAM_SPORTS,
}={}){
  const eligible=dedupeEligibleContracts(rows);
  const capacity=Math.max(0,Math.floor(Number(maxContracts)||0));
  const perConn=Math.max(1,Math.min(STREAM_SUBSCRIBE_BATCH_MAX,Math.floor(Number(maxPerConnection)||STREAM_DEFAULT_MAX_PER_CONNECTION)));
  const connCap=Math.max(1,Math.floor(Number(maxConnections)||Math.ceil(Math.max(capacity,1)/perConn)));

  const groups=new Map(sports.map(s=>[s,[]]));
  for(const row of eligible){
    const g=groups.get(row.sport);
    if(g)g.push(row);
  }
  // Prefer sooner kickoffs, then moneyline, then fresher collection.
  for(const list of groups.values()){
    list.sort((a,b)=>{
      const aFuture=String(a.event_start_time||"");
      const bFuture=String(b.event_start_time||"");
      if(aFuture!==bFuture)return aFuture.localeCompare(bFuture);
      const fam=(x)=>x.market_family==="moneyline"?0:x.market_family==="spread"?1:2;
      if(fam(a)!==fam(b))return fam(a)-fam(b);
      return String(b.collected_at||"").localeCompare(String(a.collected_at||""));
    });
  }

  const assigned=[];
  const assignedSlugs=new Set();
  const bySport={};
  const cursors=new Map(sports.map(s=>[s,0]));
  for(const sport of sports)bySport[sport]={eligible:groups.get(sport)?.length||0,assigned:0,uncovered:0};

  const takeNext=(sport)=>{
    const list=groups.get(sport)||[];
    let i=cursors.get(sport)||0;
    while(i<list.length&&assignedSlugs.has(list[i].source_market_id))i+=1;
    cursors.set(sport,i);
    if(i>=list.length||assigned.length>=capacity)return false;
    const row=list[i];
    assigned.push(row);assignedSlugs.add(row.source_market_id);
    bySport[sport].assigned+=1;cursors.set(sport,i+1);
    return true;
  };

  // Floor: ensure each sport with inventory gets minPerSport when capacity allows.
  const floor=Math.max(0,Math.floor(Number(minPerSport)||0));
  if(floor>0){
    for(const sport of sports){
      for(let n=0;n<floor&&assigned.length<capacity;n++){
        if(!takeNext(sport))break;
      }
    }
  }

  // Round-robin remaining inventory across sports (per-sport cursors skip taken rows).
  let progressed=true;
  while(progressed&&assigned.length<capacity){
    progressed=false;
    for(const sport of sports){
      if(assigned.length>=capacity)break;
      if(takeNext(sport))progressed=true;
    }
  }

  const uncovered=[];
  for(const row of eligible){
    if(assignedSlugs.has(row.source_market_id))continue;
    bySport[row.sport].uncovered++;
    uncovered.push({
      source_market_id:row.source_market_id,
      sport:row.sport,
      canonical_event_id:row.canonical_event_id||null,
      reason:assigned.length>=capacity?"CAPACITY":"UNASSIGNED",
    });
  }

  // Partition assigned contracts across connections (each ≤ perConn / subscribe batch).
  const partitions=[];
  for(let i=0;i<assigned.length;i+=perConn){
    if(partitions.length>=connCap){
      // Shift overflow back to uncovered — connection budget exhausted.
      for(const row of assigned.splice(i)){
        assignedSlugs.delete(row.source_market_id);
        bySport[row.sport].assigned--;
        bySport[row.sport].uncovered++;
        uncovered.push({
          source_market_id:row.source_market_id,
          sport:row.sport,
          canonical_event_id:row.canonical_event_id||null,
          reason:"CONNECTION_BUDGET",
        });
      }
      break;
    }
    const slice=assigned.slice(i,i+perConn);
    partitions.push({
      id:partitions.length,
      marketSlugs:slice.map(r=>r.source_market_id),
      contracts:slice,
      size:slice.length,
    });
  }

  for(const sport of sports){
    bySport[sport].coveragePct=bySport[sport].eligible
      ? Math.round((bySport[sport].assigned/bySport[sport].eligible)*1000)/10
      : null;
    bySport[sport].status=bySport[sport].eligible===0?"NO_VERIFIED_MARKETS"
      : bySport[sport].uncovered===0?"HEALTHY"
        : bySport[sport].assigned>0?"PARTIAL"
          :"UNAVAILABLE";
  }

  return {
    eligibleCount:eligible.length,
    assigned,
    assignedCount:assigned.length,
    uncovered,
    uncoveredCount:uncovered.length,
    bySport,
    partitions,
    capacity:{
      maxContracts:capacity,
      maxPerConnection:perConn,
      maxConnections:connCap,
      minPerSport:floor,
      subscribeBatchMax:STREAM_SUBSCRIBE_BATCH_MAX,
      utilizedConnections:partitions.length,
    },
    fairness:"round-robin-all-sports-with-min-floor",
    canAuthorizeWager:false,
  };
}

/**
 * @deprecated Prefer manageSubscriptionCapacity. Kept as a thin adapter for
 * callers that still pass {perSport,maxMarkets}.
 */
export function fairMarketSelection(rows,{perSport=6,maxMarkets=48}={}){
  const plan=manageSubscriptionCapacity(rows,{
    maxContracts:maxMarkets,
    maxPerConnection:STREAM_SUBSCRIBE_BATCH_MAX,
    minPerSport:0,
  });
  // Preserve legacy tennis bias only when using the old 48/6 profile.
  if(maxMarkets<=48&&perSport>=5){
    const tennis=(plan.assigned.filter(r=>r.sport==="tennis"));
    if(tennis.length<Math.min(perSport,6)){
      // Re-run with a tennis floor via round-robin already covers fairly;
      // return plan.assigned truncated — manageSubscriptionCapacity is the source of truth.
    }
  }
  return plan.assigned.slice(0,maxMarkets);
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
    standardOrAlt:"unknown",period:base.period||"unspecified",sourceMarketId:tick.marketSlug,
    sourceOutcomeId:base.source_outcome_id,fetchedAt:tick.at,
    executionEligible:false,canQualify:false,canAuthorizeWager:false,
    raw:{providerEventId:base.provider_event_id,providerMarketId:tick.marketSlug,
      providerOutcomeId:base.source_outcome_id,contractBindingVerified:true,contractLong:true,quoteKind:"WS_LIVE_BBO_UNVERIFIED_FILL",
      bestBid:tick.bestBid,bestAsk:tick.bestAsk,lastTrade:tick.lastTrade,
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
