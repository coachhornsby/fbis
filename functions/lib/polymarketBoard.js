import {polymarketUsPeriod,polymarketUsMarketFamily,polymarketUsSideLabel} from "./polymarketUs.js";
/**
 * Market display overlay only: read immutable Polymarket US and soccer PinnOdds observations.
 * Never hydrate stale quotes as actionable execution prices or model inputs.
 */
import { marketTemporalStatus, providerObservationTime } from "./marketTemporal.js";

export async function loadPolymarketUsBoardOffers(db,games=[],sport,{now=new Date(),maxAgeMs=45*60*1000}={}){
 const ids=[...new Set(games.map(g=>String(g.id||"")).filter(Boolean))];
 if(!db?.prepare||!ids.length)return {byId:new Map(),source:"Polymarket US",available:false};
 const end=now.toISOString(),cutoff=new Date(now.getTime()-(sport==="soccer"?7*3600000:maxAgeMs)).toISOString();
 const rows=[];
 for(let i=0;i<ids.length;i+=40){
 const chunk=ids.slice(i,i+40);
 const params=chunk.map(()=>"?").join(",");
 const query=`WITH fresh AS (
  SELECT id,canonical_event_id,sport,source,market_family,side,line,period,contract_price,decimal_odds,american_odds,source_market_id,source_outcome_id,event_start_time,
    collected_at,source_observed_at,raw_payload_json,execution_eligible,can_qualify,can_authorize_wager,
    ROW_NUMBER() OVER (PARTITION BY source,canonical_event_id,market_family,source_market_id,source_outcome_id,period,side,line ORDER BY collected_at DESC,id DESC) rn
  FROM normalized_market_observations
  WHERE source IN (${sport === 'soccer' ? "'Polymarket US','Polymarket US WebSocket','PinnOdds'" : "'Polymarket US','Polymarket US WebSocket'"}) AND sport=? AND canonical_event_id IN (${params})
    AND collected_at BETWEEN ? AND ?
    AND (event_start_time IS NULL OR event_start_time >= ?)
 ) SELECT * FROM fresh WHERE rn=1 ORDER BY canonical_event_id,CASE WHEN source='Polymarket US WebSocket' THEN 0 ELSE 1 END,market_family,source_market_id,id LIMIT ? OFFSET ?`;
 for(let offset=0;;offset+=500){
 const page=(await db.prepare(query).bind(sport,...chunk,cutoff,end,
   new Date(now.getTime()-8*60*60*1000).toISOString(),500,offset).all())?.results||[];
 rows.push(...page);
 if(page.length<500)break;
 }
 }
 const byId=new Map();
 for(const r of rows){
  const key=String(r.canonical_event_id);
  if(!byId.has(key))byId.set(key,[]);
  const arr=byId.get(key);

  const display=Number(r.contract_price);
  let raw=null;
  if(r.source==="Polymarket US WebSocket"){
    try{
      const parsed=JSON.parse(String(r.raw_payload_json||"null"));
      // Expose only numeric book fields; never forward private raw data to card JSON.
      const price=v=>v==null||v===""?null:Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<1?Number(v):null;
      raw={bestBid:price(parsed?.bestBid),bestAsk:price(parsed?.bestAsk),
        settlementVerified:parsed?.settlementVerified===true,
        includesOvertimeAndShootout:parsed?.includesOvertimeAndShootout===true};
    }catch{raw=null}
  }
  let payload=null;
  try{payload=JSON.parse(r.raw_payload_json||"null")}catch{}
  const soccerContract=sport==="soccer"&&payload?.providerMarket;
  const family=soccerContract?polymarketUsMarketFamily(payload.providerMarket):r.market_family;
  const period=soccerContract?polymarketUsPeriod(payload.providerMarket):r.period;
  const side=soccerContract?polymarketUsSideLabel(payload.providerMarket,payload.providerSide,"soccer"):r.side;
  if(soccerContract&&family==="moneyline"&&payload.contractLong!==true)continue;
  if(sport==="soccer"&&r.source==="Polymarket US WebSocket"&&payload?.contractBindingVerified!==true)continue;
  const providerObservedAt=providerObservationTime({source:r.source,raw:payload,sourceObservedAt:
    payload && Object.hasOwn(payload,"sourceObservedAt") ? payload.sourceObservedAt :
    payload?.quoteProvenance==="collector-capture-only" ? null : r.source_observed_at});
  const temporal=marketTemporalStatus({source:r.source,providerObservedAt,collectedAt:r.collected_at,
    eventId:r.canonical_event_id,eventStartAt:r.event_start_time},{now,maxAgeMs});
  const historicalReference=sport==="soccer"&&r.source==="PinnOdds"&&!temporal.currentDisplayEligible&&temporal.researchEligible&&now.getTime()-Date.parse(r.collected_at)<=7*3600000;
  if(!temporal.currentDisplayEligible&&!historicalReference)continue;
  arr.push({
    source:r.source,marketFamily:family,side,period,
    historicalReference,line:r.line,contractPrice:r.contract_price==null?null:Number.isFinite(display)?display:null,
    decimalOdds:r.decimal_odds==null?null:Number(r.decimal_odds),
    americanOdds:r.source==="PinnOdds"&&r.american_odds!=null?Number(r.american_odds):null,quoteKind:r.source==="PinnOdds"?"DECIMAL_BOOK_REFERENCE_NOT_EXECUTION_VERIFIED":r.source==="Polymarket US WebSocket"?"OBSERVED_BBO_NOT_GUARANTEED_FILL":"DISPLAY_REFERENCE_NOT_EXECUTABLE",
    sourceMarketId:r.source_market_id,sourceOutcomeId:r.source_outcome_id,observedAt:providerObservedAt,collectedAt:r.collected_at,
    sourceObservedAt:providerObservedAt,providerObservedAt,temporal,raw,
    executionEligible:false,canQualify:false,canAuthorizeWager:false
  });
 }
 return {byId,source:"Polymarket US",available:[...byId.values()].some(x=>x.length>0),diagnostics:{requestedEvents:ids.length,loadedObservations:rows.length,displayedOffers:[...byId.values()].reduce((n,x)=>n+x.length,0)}};
}
export function attachPolymarketBoardOffers(cards,loaded){
 return (cards||[]).map(card=>{
  const offers=loaded?.byId?.get(String(card.id||""))||[];
  if(!offers.length)return card;
  return {...card,market:{...(card.market||{}),venueOffers:[
    ...(card.market?.venueOffers||[]),...offers]}}
 });
}
