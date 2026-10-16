import { FBIS_POLY_SPORTS } from "../lib/polymarketUs.js";
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
/** Public research coverage status. No account data or trading credentials. */
export async function onRequestGet({env}){
 if(!env.DB?.prepare)return json({ok:false,error:"database-unavailable"},503);
 try{
  const now=new Date(),cutoff=new Date(now.getTime()-24*3600000).toISOString();
  const r=await env.DB.prepare(`SELECT sport,COUNT(*) observations,MAX(collected_at) last_capture,
    COUNT(DISTINCT provider_event_id) provider_events,
    COUNT(DISTINCT canonical_event_id) matched_games,
    SUM(CASE WHEN canonical_event_id IS NULL THEN 1 ELSE 0 END) unmatched_observations,
    SUM(CASE WHEN contract_price IS NOT NULL THEN 1 ELSE 0 END) displayed_prices
    FROM normalized_market_observations WHERE source='Polymarket US' AND collected_at>=?1
    GROUP BY sport`).bind(cutoff).all();
  const ws=await env.DB.prepare(`SELECT COUNT(*) n,MAX(collected_at) last_capture,
      COUNT(DISTINCT canonical_event_id) matched_games,
      COUNT(DISTINCT source_market_id) contracts
      FROM normalized_market_observations
      WHERE source='Polymarket US WebSocket' AND collected_at>=?1`).bind(cutoff).first();
  // Coverage must be evaluated by sport; a healthy multi-sport socket does
  // not imply any live ATP/WTA subscriptions or a verified tennis schedule.
  const tennisSources=await env.DB.prepare(`SELECT source,COUNT(*) observations,
      COUNT(DISTINCT source_market_id) contracts,COUNT(DISTINCT provider_event_id) provider_events,
      COUNT(DISTINCT canonical_event_id) matched_events,MAX(collected_at) last_capture,
      SUM(CASE WHEN event_start_time>=?2 THEN 1 ELSE 0 END) upcoming_observations
      FROM normalized_market_observations
      WHERE sport='tennis' AND source IN ('Polymarket US','Polymarket US WebSocket')
      AND collected_at>=?1 GROUP BY source`).bind(cutoff,now.toISOString()).all();
  const officialTennis=await env.DB.prepare(`SELECT COUNT(*) n FROM tennis_official_matches
      WHERE source IN ('ATP_OFFICIAL','WTA_OFFICIAL') AND match_time>=?1
      AND player1_id IS NOT NULL AND player2_id IS NOT NULL`).bind(now.toISOString()).first();
  const espnTennis=await env.DB.prepare(`SELECT COUNT(*) n FROM tennis_external_fixtures
      WHERE source='ESPN_PUBLIC' AND status IN ('SCHEDULED','IN_PROGRESS')
      AND match_time>=?1 AND fetched_at>=?2`)
      .bind(now.toISOString(),new Date(now.getTime()-18*3600000).toISOString()).first();
  let stream=null;
  try{const response=await fetch("https://fbis-polymarket-us-stream.coachhornsby.workers.dev/health",{signal:AbortSignal.timeout(4000)});
   if(response.ok){const value=await response.json();if(value.ok===true)stream=value;}
  }catch{}
  const by=new Map((r.results||[]).map(x=>[x.sport,x]));
  const tennisMap=new Map((tennisSources.results||[]).map(x=>[x.source,x]));
  const tennisRest=tennisMap.get('Polymarket US')||{};
  const tennisWs=tennisMap.get('Polymarket US WebSocket')||{};
  const upcoming=Number(tennisRest.upcoming_observations||0);
  const officialCount=Number(officialTennis?.n||0);
  const externalCount=Number(espnTennis?.n||0);
  const tennisStatus=officialCount===0&&externalCount===0?'OFFICIAL_SCHEDULE_MISSING':
    officialCount===0&&externalCount>0&&upcoming===0?'INDEPENDENT_RESEARCH_SCHEDULE_ONLY':
    officialCount===0&&externalCount>0&&Number(tennisRest.matched_events||0)>0?'RESEARCH_FIXTURES_MATCHED':
    upcoming>0&&Number(tennisRest.matched_events||0)===0?'UPCOMING_MARKETS_UNMATCHED':
    upcoming===0?'NO_UPCOMING_REST_CONTRACTS':
    Number(tennisWs.observations||0)===0?'UPCOMING_REST_ONLY_NO_WEBSOCKET':'RESEARCH_OBSERVATIONS';
  const states=FBIS_POLY_SPORTS.map(s=>{
   const item=by.get(s);return {sport:s,
    status:item?.observations>0?"RECENT_OBSERVATIONS":"NO_RECENT_MARKET_CAPTURE",
    observationCount:Number(item?.observations||0),
    providerEvents:Number(item?.provider_events||0),
    matchedGames:Number(item?.matched_games||0),
    unmatchedObservations:Number(item?.unmatched_observations||0),
    displayedPrices:Number(item?.displayed_prices||0),
    lastCapture:item?.last_capture||null}
  });
  return json({ok:true,source:"Polymarket US public gateway",
    region:"US",windowHours:24,readOnly:true,canQualify:false,canAuthorizeWager:false,
    fullMarketCoverageVerified:false,
    tennisCoverage:{status:tennisStatus,officialUpcomingMatches:officialCount,
      independentResearchUpcomingFixtures:externalCount,
      scheduleAuthority:officialCount>0?'ATP_WTA_OFFICIAL_EVIDENCE':externalCount>0?'ESPN_PUBLIC_RESEARCH_ONLY':'UNAVAILABLE',
      rest:{observations:Number(tennisRest.observations||0),providerEvents:Number(tennisRest.provider_events||0),
        matchedEvents:Number(tennisRest.matched_events||0),contracts:Number(tennisRest.contracts||0),
        upcomingObservations:upcoming,lastCapture:tennisRest.last_capture||null},
      websocket:{observations:Number(tennisWs.observations||0),contracts:Number(tennisWs.contracts||0),
        matchedEvents:Number(tennisWs.matched_events||0),lastCapture:tennisWs.last_capture||null},
      canQualify:false,canAuthorizeWager:false},
    signedMarketWebsocket:{
      credentialsConfigured:Boolean(env.POLYMARKET_US_KEY_ID&&env.POLYMARKET_US_SECRET_KEY),
      readOnly:true,
      lastBboCapture:ws?.last_capture||null,
      bboRecordsLast24h:Number(ws?.n||0),
      matchedEventsLast24h:Number(ws?.matched_games||0),
      contractCountLast24h:Number(ws?.contracts||0),
      operational:stream?.operational===true,
      connectionStatus:stream?stream.connected?"CONNECTED":"DISCONNECTED":"HEALTH_UNAVAILABLE",
      lastMessageAt:stream?.lastMessageAt||null,
      lastHeartbeatAt:stream?.lastHeartbeatAt||null,
      lastError:stream?.lastError||null,
      lastClose:stream?.lastClose||null,
      subscriptions:Number(stream?.subscriptions||0),
      received:Number(stream?.received||0),
      parsed:Number(stream?.parsed||0),
      inserted:Number(stream?.inserted||0),
      spilled:Number(stream?.spilled||0),
      reconnects:Number(stream?.reconnects||0),
      lastConnectAttemptAt:stream?.lastConnectAttemptAt||null,
      capacity:stream?.capacity||null,
      uncoveredCount:Number(stream?.uncoveredCount||0),
      sportCoverage:stream?.sportCoverage||null,
      fixedCapRetired:stream?.fixedCapRetired===true,
      architecture:stream?.architecture||null,
      mode:stream?.mode||null,
      streamHealthy:stream?.streamHealthy===true,
      persistenceStatus:stream?.persistenceStatus||null,
      lastSpillKey:stream?.lastSpillKey||null,
      lastSpillAt:stream?.lastSpillAt||null,
    },sports:states});
 }catch(error){return json({ok:false,error:"market-status-unavailable",detail:String(error?.message||error)},502)}
}
export async function onRequestPost(){return json({ok:false,error:"method-not-allowed"},405)}
