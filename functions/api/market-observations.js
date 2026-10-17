import {marketTemporalStatus,providerObservationTime} from '../lib/marketTemporal.js';
import {FBIS_POLY_SPORTS} from '../lib/polymarketUs.js';
import {marketDisplayAmerican,marketDisplayImplied} from '../../src/lib/marketQuoteDisplay.js';
import {coldHistoryEnabled,readColdCompatibleEventObservations} from '../lib/coldMarketHistory.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
/** Public event research read. Latest immutable observation per exact source contract. */
export async function onRequestGet({env,request}){
 const url=new URL(request.url),sport=url.searchParams.get('sport'),eventId=url.searchParams.get('eventId'),cursor=url.searchParams.get('cursor')||'0';
 if(!FBIS_POLY_SPORTS.includes(sport)||!eventId||eventId.length>160||!/^\d{1,7}$/.test(cursor))return json({ok:false,error:'INVALID_EVENT_QUERY'},400);
 if(!env.DB?.prepare)return json({ok:false,error:'DATABASE_UNAVAILABLE'},503);
 try{return json(await marketObservationPage(env,{sport,eventId,offset:Number(cursor),pageSize:100,now:new Date()}));}
 catch{return json({ok:false,error:'MARKET_READ_UNAVAILABLE'},502);}
}
/** Shared by the HTTP route and authenticated fixed-clock storage parity probe. */
export async function marketObservationPage(env,{sport,eventId,offset=0,pageSize=100,now=new Date()}){
  const result=coldHistoryEnabled(env)?await readColdCompatibleEventObservations(env,{sport,eventId,offset,pageSize}):await env.DB.prepare(`WITH latest AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY source,source_market_id,source_outcome_id,period,side,line,player_name,stat_family ORDER BY collected_at DESC,id DESC) rn
   FROM normalized_market_observations WHERE sport=? AND canonical_event_id=? AND source IN ('Polymarket US','Polymarket US WebSocket','PinnOdds','PrizePicks GitHub Mirror'))
   SELECT * FROM latest WHERE rn=1 ORDER BY source,market_family,period,source_market_id,source_outcome_id,id LIMIT ? OFFSET ?`).bind(sport,eventId,pageSize+1,offset).all();
  const found=result?.results||[],hasMore=found.length>pageSize;
  const rows=found.slice(0,pageSize).map(r=>{
   let raw={};try{raw=JSON.parse(r.raw_payload_json||'{}')||{}}catch{}
   const providerObservedAt=providerObservationTime({source:r.source,sourceObservedAt:Object.hasOwn(raw,'sourceObservedAt')?raw.sourceObservedAt:raw.quoteProvenance==='collector-capture-only'?null:r.source_observed_at});
   const temporal=marketTemporalStatus({source:r.source,providerObservedAt,collectedAt:r.collected_at,eventId:r.canonical_event_id,eventStartAt:r.event_start_time},{now});
   if(r.source==='PrizePicks GitHub Mirror')Object.assign(temporal,{status:'DAILY_REFERENCE',providerTimeConfidence:'MIRROR_REPORTED_CAPTURE',currentDisplayEligible:false,prospectiveEvidenceEligible:false,modelInputEligible:false});
   return{id:r.id,source:r.source,eventId:r.canonical_event_id,sport:r.sport,playerName:r.player_name,marketFamily:r.market_family,statFamily:r.stat_family,
    side:r.side,line:r.line,period:r.period,americanOdds:r.american_odds,decimalOdds:r.decimal_odds,contractPrice:r.contract_price,
    displayAmericanOdds:marketDisplayAmerican({americanOdds:r.american_odds,decimalOdds:r.decimal_odds,contractPrice:r.contract_price}),displayImpliedProbability:marketDisplayImplied({americanOdds:r.american_odds,decimalOdds:r.decimal_odds,contractPrice:r.contract_price}),displayPriceKind:r.contract_price!=null?'CONTRACT_COST_IMPLIED':r.decimal_odds!=null?'DECIMAL_RAW_IMPLIED':'AMERICAN_RAW_IMPLIED',
    sourceMarketId:r.source_market_id,sourceOutcomeId:r.source_outcome_id,providerObservedAt,collectedAt:r.collected_at,temporal,
    quoteKind:raw.quoteKind||raw.priceKind||'OBSERVED_REFERENCE',canQualify:false,canAuthorizeWager:false};
  });
  return {ok:true,eventId,sport,rows,pageSize,cursor:String(offset),nextCursor:hasMore?String(offset+pageSize):null,readOnly:true,canAuthorizeWager:false};
}
