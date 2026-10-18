import {polymarketUsPeriod,polymarketUsMarketFamily,polymarketUsSideLabel,polymarketUsCanonicalSide} from "./polymarketUs.js";
/**
 * Market display overlay only: read immutable Polymarket US and soccer PinnOdds observations.
 * Never hydrate stale quotes as actionable execution prices or model inputs.
 */
import { marketTemporalStatus, providerObservationTime } from "./marketTemporal.js";

export async function loadPolymarketUsBoardOffers(db,games=[],sport,{now=new Date(),maxAgeMs=45*60*1000,historyDb=null,deliveryStore="PRIMARY_D1",moneylineOnly=false}={}){
 if(historyDb?.prepare){
  const attempts=await Promise.allSettled([loadPolymarketUsBoardOffers(db,games,sport,{now,maxAgeMs,moneylineOnly}),loadPolymarketUsBoardOffers(historyDb,games,sport,{now,maxAgeMs,deliveryStore:"MARKET_HISTORY_RECOVERY",moneylineOnly})]);
  const byId=new Map();
  for(const result of attempts){if(result.status!=="fulfilled")continue;for(const [id,offers] of result.value.byId){
   const merged=new Map((byId.get(id)||[]).map(o=>[[o.source,o.sourceMarketId,o.sourceOutcomeId,o.period,o.side,o.line].join("|"),o]));
   for(const o of offers){const key=[o.source,o.sourceMarketId,o.sourceOutcomeId,o.period,o.side,o.line].join("|");const old=merged.get(key);
    if(!old||Date.parse(o.observedAt||o.collectedAt)>Date.parse(old.observedAt||old.collectedAt))merged.set(key,o);}
   byId.set(id,[...merged.values()]);
  }}
  return {byId,source:"Polymarket US",available:[...byId.values()].some(x=>x.length),diagnostics:{primaryAvailable:attempts[0].status==="fulfilled",historyAvailable:attempts[1].status==="fulfilled",displayedOffers:[...byId.values()].reduce((n,x)=>n+x.length,0)}};
 }
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
  FROM normalized_market_observations INDEXED BY idx_norm_market_event_time
  WHERE source IN (${sport === 'soccer' ? "'Polymarket US','Polymarket US WebSocket','PinnOdds'" : "'Polymarket US','Polymarket US WebSocket'"}) AND sport=? ${moneylineOnly?"AND market_family='moneyline'":""} AND canonical_event_id IN (${params})
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
 const spreadBindings=new Map();
 for(const r of rows){
  if(r.market_family!=='spread'||r.source!=='Polymarket US')continue;
  let p;try{p=JSON.parse(r.raw_payload_json||'null')}catch{continue;}
  const side=p?.providerMarket?.marketSides?.find(s=>String(s.id)===String(r.source_outcome_id))||
    (String(p?.providerSide?.id)===String(r.source_outcome_id)?p.providerSide:null);
  if(!side)continue;
  const fixture=games.find(g=>String(g.id)===String(r.canonical_event_id));
  const canonical=polymarketUsCanonicalSide({sport,marketFamily:'spread',side:side.description,raw:{providerSide:side}},fixture);
  const signed=/^[+-]?\d+(?:\.\d+)?$/.test(side.description||'')?Number(side.description):null;
  if(canonical&&signed!=null&&Math.abs(Math.abs(signed)-Math.abs(Number(r.line)))<.00001)
   spreadBindings.set(r.source_market_id+'|'+r.source_outcome_id,{side:canonical,line:signed});
 }
 const byId=new Map();
 for(const r of rows){
  const key=String(r.canonical_event_id);
  if(!byId.has(key))byId.set(key,[]);
  const arr=byId.get(key);

  const display=Number(r.contract_price);
  let raw=null;
  if(r.source==="Polymarket US WebSocket"||r.source==="Polymarket US"){
    try{
      const parsed=JSON.parse(String(r.raw_payload_json||"null"));
      // Expose only numeric book fields; never forward private raw data to card JSON.
      const price=v=>v==null||v===""?null:Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<1?Number(v):null;
      const levels=xs=>Array.isArray(xs)?xs.slice(0,20).map(x=>({price:price(x.price??x.px?.value??x.px),quantity:Number(x.quantity??x.qty)})).filter(x=>x.price!=null&&Number.isFinite(x.quantity)&&x.quantity>0):[];
      raw={bestBid:price(parsed?.bestBid),bestAsk:price(parsed?.bestAsk),
        bids:levels(parsed?.bids),offers:levels(parsed?.offers),marketState:typeof parsed?.marketState==="string"?parsed.marketState:null,
        tradeCount:Number.isSafeInteger(parsed?.tradeCount)?parsed.tradeCount:null,feeCoefficient:parsed?.feeCoefficient==null?null:Number(parsed.feeCoefficient),
        settlementVerified:parsed?.settlementVerified===true,
        includesOvertimeAndShootout:parsed?.includesOvertimeAndShootout===true};
    }catch{raw=null}
  }
  let payload=null;
  try{payload=JSON.parse(r.raw_payload_json||"null")}catch{}
  const soccerContract=sport==="soccer"&&payload?.providerMarket;
  const family=soccerContract?polymarketUsMarketFamily(payload.providerMarket):r.market_family;
  const period=soccerContract?polymarketUsPeriod(payload.providerMarket):r.period;
  const matchedGame=games.find(g=>String(g.id)===String(r.canonical_event_id));
  const binding=spreadBindings.get(r.source_market_id+'|'+r.source_outcome_id);
  const inferredSide=family==='spread'?(binding?.side||polymarketUsCanonicalSide({marketFamily:family,sport,side:r.side,raw:payload},matchedGame)):null;
  const side=['moneyline','spread'].includes(family)&&['home','away','draw'].includes(payload?.canonicalSide)?payload.canonicalSide:inferredSide|| (soccerContract?polymarketUsSideLabel(payload.providerMarket,payload.providerSide,"soccer"):r.side);
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
    source:r.source,marketFamily:family,side:family==='total'&&/^(over|under)\b/i.test(side)?side.match(/^(over|under)/i)[1].toLowerCase():side,period,deliveryStore,
    historicalReference,line:binding?.line!=null?binding.line:family==='spread'&&payload?.contractLong===false&&payload?.sideSpecificLine!==true&&r.line!=null?-Number(r.line):r.line,contractPrice:r.contract_price==null?null:Number.isFinite(display)?display:null,
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
  const venueOffers=[...(card.market?.venueOffers||[]),...offers];
  const next={...card,market:{...(card.market||{}),venueOffers}};
  // Tennis readers historically preferred tennisProjection.venueOffers; keep both in sync.
  if(String(card.sport||"").toLowerCase()==="tennis"&&card.tennisProjection){
   next.tennisProjection={...card.tennisProjection,venueOffers:[
     ...(card.tennisProjection.venueOffers||[]),...offers]};
  }
  return next;
 });
}
