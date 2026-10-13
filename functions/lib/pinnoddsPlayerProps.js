/** Event research rows. Provider player labels never become canonical player identities. */
export async function loadPinnoddsPlayerProps(db,eventIds=[],sport=null){
 if(!eventIds.length)return[];
 const result=await db.prepare(`WITH latest AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY source_market_id,source_outcome_id,period,line,side ORDER BY collected_at DESC,id DESC) rn
  FROM normalized_market_observations WHERE source='PinnOdds' AND market_family='player_prop' AND canonical_event_id IN (${eventIds.map(()=>'?').join(',')}) ${sport?'AND sport=?':''}
  AND julianday(collected_at) BETWEEN julianday('now','-24 hours') AND julianday('now')) SELECT * FROM latest WHERE rn=1 ORDER BY canonical_event_id,player_name,period,line,source_market_id,source_outcome_id`).bind(...eventIds,...(sport?[sport]:[])).all();
 const groups=new Map();
 for(const r of result?.results||[]){
  let raw={};try{raw=JSON.parse(r.raw_payload_json||'{}')||{}}catch{}
  const selection=String(r.side||'').toLowerCase(),pairable=/^(over|under)(\s|$)/.test(selection);
  const identity=[r.canonical_event_id,r.provider_event_id,r.period,r.line,r.player_name,r.stat_family,raw.original?.market?.type,raw.original?.market?.key,pairable?'pair':r.source_outcome_id].join('|');
  if(!groups.has(identity))groups.set(identity,{provider:'PINNODDS',sport:r.sport,fbisEventId:r.canonical_event_id,providerGameId:r.provider_event_id,
   providerPlayerId:raw.providerPlayerId||null,fbisPlayerId:null,playerName:r.player_name,market:r.stat_family||raw.marketRaw||raw.unitsRaw,marketCanonical:r.stat_family,
   period:r.period,book:'PinnOdds',line:r.line,side:pairable?null:r.side,price:null,overOdds:null,underOdds:null,
   overDecimalOdds:null,underDecimalOdds:null,decimalPrice:pairable?null:r.decimal_odds,
   sourceObservedAt:r.source_observed_at,collectedAt:r.collected_at,providerTimeConfidence:'UNKNOWN',fbisProjection:null,
   gameIdentityConfidence:raw.eventMatchStatus||'UNKNOWN',playerIdentityConfidence:r.player_name?'PROVIDER_LABEL_ONLY':'UNKNOWN',
   quoteKind:'DECIMAL_BOOK_REFERENCE_NOT_EXECUTION_VERIFIED',marketComplete:r.decimal_odds!=null,
   decisionEligible:false,canQualify:false,canAuthorizeWager:false,reasonCodes:['PINNODDS_OBSERVED_RESEARCH','PROVIDER_QUOTE_TIME_UNKNOWN','NOT_DECISION_ELIGIBLE']});
  const row=groups.get(identity);if(pairable){if(selection.startsWith('over'))row.overDecimalOdds=r.decimal_odds;else row.underDecimalOdds=r.decimal_odds;}
 }
 return [...groups.values()];
}
