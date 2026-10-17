import {loadSoccerMarketFixtures} from './soccerMarketFixtures.js';
import {matchPolymarketUsEvent,polymarketUsPeriod} from './polymarketUs.js';
import {persistNormalizedMarketObservation} from './marketObservationLedger.js';
import {coldHistoryEnabled,readColdCompatibleReconcilePage,marketObservationDatabase,coldMarketPartitions} from './coldMarketHistory.js';
/** Append corrected identities. Never rewrite raw captures, prices or clocks. */
export async function reconcileSoccerMarkets(env,{limit=100,afterId="",now=new Date()}={}){
 const directory=await loadSoccerMarketFixtures(env,{now});
 const archivedPage=coldHistoryEnabled(env)?await readColdCompatibleReconcilePage(env,{from:new Date(now.getTime()-86400000).toISOString(),until:new Date(now.getTime()+7*86400000).toISOString(),now:now.toISOString(),afterId,limit}):null;
 const rows=archivedPage?.rows||(await env.DB.prepare(`WITH ranked AS (
 SELECT *,ROW_NUMBER() OVER(PARTITION BY source,source_market_id,source_outcome_id,period,side,line ORDER BY collected_at DESC,CASE WHEN canonical_event_id IS NULL THEN 1 ELSE 0 END,id DESC) rn
 FROM normalized_market_observations WHERE sport='soccer' AND source IN ('PinnOdds','Polymarket US','Polymarket US WebSocket')
 AND event_start_time BETWEEN ? AND ? AND collected_at<=?
 ) SELECT * FROM ranked WHERE rn=1 AND canonical_event_id IS NULL AND id>? ORDER BY id LIMIT ?`).bind(new Date(now.getTime()-86400000).toISOString(),new Date(now.getTime()+7*86400000).toISOString(),now.toISOString(),afterId,limit).all())?.results||[];
 let matched=0,inserted=0;const reasons={},links=[];
 for(const r of rows){let raw={};try{raw=JSON.parse(r.raw_payload_json||'{}')||{}}catch{}
  let title=raw.providerTitle,period=raw.providerMarket?polymarketUsPeriod(raw.providerMarket):r.period;
  if(r.source==='Polymarket US WebSocket'&&raw.contractBindingVerified!==true){reasons.WS_CONTRACT_BINDING_UNVERIFIED=(reasons.WS_CONTRACT_BINDING_UNVERIFIED||0)+1;continue;}
  if(!title&&!r.home_team&&!r.away_team&&r.source==='Polymarket US WebSocket'){
   let metadata=await env.DB.prepare(`SELECT raw_payload_json,collected_at FROM normalized_market_observations WHERE source='Polymarket US' AND sport='soccer' AND provider_event_id=? AND event_start_time=? ORDER BY collected_at DESC LIMIT 1`).bind(r.provider_event_id,r.event_start_time).first();
   if(coldHistoryEnabled(env)){const parts=await coldMarketPartitions(env);const cold=await parts[1].db.prepare(`SELECT raw_payload_json,collected_at FROM normalized_market_observations WHERE source='Polymarket US' AND sport='soccer' AND snapshot_type='RESEARCH' AND provider_event_id=? AND event_start_time=? ORDER BY collected_at DESC LIMIT 1`).bind(r.provider_event_id,r.event_start_time).first();if(cold&&(!metadata||cold.collected_at>metadata.collected_at))metadata=cold;}
   try{title=JSON.parse(metadata?.raw_payload_json||'{}').providerTitle}catch{}
  }
  const identity=matchPolymarketUsEvent({startTime:r.event_start_time,homeTeam:{name:r.home_team},awayTeam:{name:r.away_team},title},directory.fixtures,'soccer');
  if(!identity.id){reasons[identity.reason]=(reasons[identity.reason]||0)+1;continue;}
  const fixture=directory.fixtures.find(g=>g.id===identity.id);matched++;
  const saved=await persistNormalizedMarketObservation(await marketObservationDatabase(env,r.collected_at),{
   source:r.source,sourceType:r.source_type,sport:'soccer',league:r.league,eventId:identity.id,eventStart:r.event_start_time,
   homeTeam:fixture.home_name,awayTeam:fixture.away_name,marketFamily:r.market_family,side:r.side,line:r.line,period,
   decimalOdds:r.decimal_odds,americanOdds:r.american_odds,contractPrice:r.contract_price,
   sourceMarketId:r.source_market_id,sourceOutcomeId:r.source_outcome_id,sourceObservedAt:r.source_observed_at,
   raw:{...raw,rematchedFromObservationId:r.id,identityLinkedAt:now.toISOString(),fixtureObservedAt:directory.observedAt,fixtureSource:'ESPN',postCaptureIdentityLink:true,eventMatchStatus:identity.reason},executionEligible:false
  },{collectedAt:r.collected_at,snapshotType:'RESEARCH'});
  inserted+=saved.inserted?1:0;links.push({eventId:identity.id,source:r.source});
 }
 return{ok:true,examined:rows.length,nextCursor:archivedPage?archivedPage.nextCursor:rows.length===limit?rows.at(-1).id:null,matched,inserted,reasons,links,fixtureCount:directory.fixtures.length,fixtureErrors:directory.errors,originalClocksPreserved:true,paidProviderCalls:0,canQualify:false,canAuthorizeWager:false};
}
