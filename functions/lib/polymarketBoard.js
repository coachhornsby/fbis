/**
 * Market display overlay only: read immutable Polymarket US observations.
 * Never hydrate stale quotes as actionable execution prices or model inputs.
 */
export async function loadPolymarketUsBoardOffers(db,games=[],sport,{now=new Date(),maxAgeMs=45*60*1000}={}){
 const ids=[...new Set(games.map(g=>String(g.id||"")).filter(Boolean))].slice(0,100);
 if(!db?.prepare||!ids.length)return {byId:new Map(),source:"Polymarket US",available:false};
 const end=now.toISOString(),cutoff=new Date(now.getTime()-maxAgeMs).toISOString();
 const params=ids.map(()=>"?").join(",");
 const query=`WITH fresh AS (
  SELECT canonical_event_id,sport,source,market_family,side,line,contract_price,source_market_id,
    collected_at,source_observed_at,execution_eligible,can_qualify,can_authorize_wager,
    ROW_NUMBER() OVER (PARTITION BY canonical_event_id,market_family,source_market_id,side,line ORDER BY collected_at DESC) rn
  FROM normalized_market_observations
  WHERE source='Polymarket US' AND sport=? AND canonical_event_id IN (${params})
    AND collected_at BETWEEN ? AND ?
    AND (event_start_time IS NULL OR event_start_time >= ?)
 ) SELECT * FROM fresh WHERE rn=1 ORDER BY canonical_event_id,market_family,source_market_id LIMIT 240`;
 const rows=(await db.prepare(query).bind(sport,...ids,cutoff,end,
   new Date(now.getTime()-8*60*60*1000).toISOString()).all())?.results||[];
 const byId=new Map();
 for(const r of rows){
  const key=String(r.canonical_event_id);
  if(!byId.has(key))byId.set(key,[]);
  const arr=byId.get(key);
  if(arr.length>=12)continue;
  const display=Number(r.contract_price);
  arr.push({
    source:"Polymarket US",marketFamily:r.market_family,side:r.side,
    line:r.line,contractPrice:r.contract_price==null?null:Number.isFinite(display)?display:null,
    americanOdds:null,quoteKind:"DISPLAY_REFERENCE_NOT_EXECUTABLE",
    sourceMarketId:r.source_market_id,observedAt:r.collected_at,
    executionEligible:false,canQualify:false,canAuthorizeWager:false
  });
 }
 return {byId,source:"Polymarket US",available:rows.length>0};
}
export function attachPolymarketBoardOffers(cards,loaded){
 return (cards||[]).map(card=>{
  const offers=loaded?.byId?.get(String(card.id||""))||[];
  if(!offers.length)return card;
  return {...card,market:{...(card.market||{}),venueOffers:[
    ...(card.market?.venueOffers||[]),...offers]}}
 });
}
