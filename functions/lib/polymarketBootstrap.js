import {POLY_US_API,classifyPolymarketUsLeague,matchPolymarketUsEvent,polymarketUsMarketOffers} from './polymarketUs.js';
import {polymarketUsSideLabel,polymarketUsCanonicalSide} from './polymarketUs.js';
import {persistNormalizedMarketBatch} from './marketObservationLedger.js';
const valid=s=>/^[a-z0-9-]{1,160}$/i.test(s||'');
const prefix='market-sources/polymarket-us/bootstrap/';
export async function projectedPolymarketFixtures(db,now=new Date()){
 if(!db?.prepare)throw Error('PRIMARY_DB_REQUIRED');
 const asOf=now.toISOString(),end=new Date(now.getTime()+48*3600000).toISOString();
 // Team sports stay on games+prediction_snapshots. Tennis uses the official
 // ATP/WTA schedule plus an independent research decision that predates both
 // capture and match start — never market prices as projection proof.
 const games=await db.prepare(`SELECT g.id,g.sport,g.start,g.home_name,g.away_name,g.home_abbr,g.away_abbr,NULL AS tour FROM games g
 WHERE julianday(g.start)>julianday(?) AND julianday(g.start)<=julianday(?) AND EXISTS (
 SELECT 1 FROM prediction_snapshots ps WHERE ps.game_id=g.id AND ps.sport=g.sport
 AND ps.model_version IS NOT NULL AND COALESCE(ps.projection_kind,'FBIS')<>'UNAVAILABLE'
 AND (ps.proj_total IS NOT NULL OR (ps.proj_home IS NOT NULL AND ps.proj_away IS NOT NULL) OR ps.p_home_final BETWEEN 0 AND 1)
 AND julianday(ps.frozen_at)<=julianday(?) AND julianday(ps.frozen_at)<julianday(g.start))
 ORDER BY g.start,g.id`).bind(asOf,end,asOf).all();
 let tennis={results:[]};
 try{
  tennis=await db.prepare(`SELECT m.match_id AS id,'tennis' AS sport,m.match_time AS start,
   p2.canonical_name AS home_name,p1.canonical_name AS away_name,
   NULL AS home_abbr,NULL AS away_abbr,lower(m.tour) AS tour
  FROM tennis_official_matches m
  JOIN tennis_players p1 ON m.player1_id=p1.fbis_player_id
  JOIN tennis_players p2 ON m.player2_id=p2.fbis_player_id
  WHERE m.source IN ('ATP_OFFICIAL','WTA_OFFICIAL')
   AND julianday(m.match_time)>julianday(?) AND julianday(m.match_time)<=julianday(?)
   AND m.player1_id IS NOT NULL AND m.player2_id IS NOT NULL AND m.player1_id<>m.player2_id
   AND lower(m.tour)=lower(p1.tour) AND lower(m.tour)=lower(p2.tour)
   AND EXISTS (
    SELECT 1 FROM tennis_v2_research_decisions d
    WHERE d.canonical_event_id=m.match_id AND d.pure_p1 BETWEEN 0 AND 1
     AND julianday(d.decision_timestamp)<=julianday(?)
     AND julianday(d.decision_timestamp)<julianday(m.match_time))
  ORDER BY m.match_time,m.match_id`).bind(asOf,end,asOf).all();
 }catch{/* tennis tables absent on older D1 snapshots */}
 return [...(games.results||[]),...(tennis.results||[])].sort((a,b)=>String(a.start).localeCompare(String(b.start))||String(a.id).localeCompare(String(b.id)));
}
async function boundedJson(fetchImpl,url,maxBytes=4e6){
 const r=await fetchImpl(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('POLYMARKET_PUBLIC_HTTP_'+r.status);
 const reader=r.body.getReader(),chunks=[];let bytes=0;
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>maxBytes)throw Error('PROVIDER_RESPONSE_TOO_LARGE');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
 const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder().decode(buffer));
}
export async function bootstrapPolymarket(env,opts={}, {fetchImpl=fetch,now=new Date()}={}){
 if(!env.ARCHIVE?.get||!env.ARCHIVE?.put)throw Error('PRIVATE_ARCHIVE_REQUIRED');
 const fixtures=await projectedPolymarketFixtures(env.DB,now);
 if(opts.operation==='resume'){
  const object=await env.ARCHIVE.get('market-sources/polymarket-us/coverage/latest.json');if(!object)return {ok:true,run:null};const previous=await object.json();
  const started=previous.runStartedAt||previous.checkedAt;
  const gaps=previous.status==='IN_PROGRESS'||previous.errors?.length||previous.missingMarketEnumeration?.length||previous.missingBooks?.length||previous.missingSubscriptions?.length;
  return {ok:true,run:gaps&&valid(previous.run)&&now.getTime()-Date.parse(started)<3600000?previous.run:null,runStartedAt:started};
 }
 if(opts.operation==='catalogue'){
  const offset=opts.offset??0;if(!Number.isSafeInteger(offset)||offset<0||offset%50)throw Error('INVALID_CATALOGUE_OFFSET');
  if(!fixtures.length)return {ok:true,leagues:[],fixtures:[],projectedFixtures:0,nextOffset:null,canAuthorizeWager:false};
  const url=new URL('/v2/leagues',POLY_US_API);url.searchParams.set('limit','50');url.searchParams.set('offset',String(offset));
  const catalogue=await boundedJson(fetchImpl,url);if(!Array.isArray(catalogue.leagues)||catalogue.leagues.length>50)throw Error('PROVIDER_CATALOGUE_CHANGED');
  const sports=new Set(fixtures.map(g=>g.sport));
  const taxonomy=await boundedJson(fetchImpl,new URL('/v2/sports',POLY_US_API));if(!Array.isArray(taxonomy.sports))throw Error('PROVIDER_SPORT_TAXONOMY_UNVERIFIED');
  const sportNames=new Map(taxonomy.sports.map(s=>[Number(s.id),s.slug]));
  return {ok:true,leagues:catalogue.leagues.map(l=>({slug:l.slug,name:l.name,providerSport:sportNames.get(Number(l.sportId)),sport:classifyPolymarketUsLeague({...l,providerSport:sportNames.get(Number(l.sportId))})})).filter(l=>sports.has(l.sport)),
   catalogueIds:catalogue.leagues.map(l=>String(l.slug)),nextOffset:catalogue.leagues.length===50?offset+50:null,
   fixtures:fixtures.map(g=>({id:String(g.id),sport:g.sport,start:g.start,home:g.home_name,away:g.away_name})),projectedFixtures:fixtures.length,canAuthorizeWager:false};
 }
 if(!valid(opts.receiptId))throw Error('INVALID_RECEIPT');
 const key=prefix+opts.receiptId+'.json';
 if(opts.operation==='page'||opts.operation==='markets'){
  if(!Number.isSafeInteger(opts.offset)||opts.offset<0||opts.offset%20)throw Error('INVALID_SCOPE');
  if(opts.operation==='page'&&(!valid(opts.slug)||classifyPolymarketUsLeague({slug:opts.slug,name:opts.name,providerSport:opts.providerSport})!==opts.sport))throw Error('INVALID_SCOPE');
  const existing=await env.ARCHIVE.get(key);if(existing){const old=await existing.json();
   const cachedQuotes=await Promise.all(Array.from({length:old.bookBatches||0},async(_,i)=>{const b=await env.ARCHIVE.get(prefix+opts.receiptId+'-quotes-'+i+'.json');return b?b.json():null;}));
   return {...old,offers:undefined,events:undefined,...(cachedQuotes.every(b=>b?.ok===true)?{cachedQuotes}: {})};}
  let scope=opts,eventPage,sourcePage,canonicalBinding=null;
  if(opts.operation==='markets'){
   if(!valid(opts.parentReceiptId)||!Number.isSafeInteger(opts.eventIndex)||opts.eventIndex<0)throw Error('INVALID_PARENT');
   const parentObject=await env.ARCHIVE.get(prefix+opts.parentReceiptId+'.json');if(!parentObject)throw Error('UNKNOWN_PARENT');
   const parent=await parentObject.json(),entry=parent.events?.[opts.eventIndex];if(!entry)throw Error('INVALID_EVENT_INDEX');
   if(!fixtures.some(g=>String(g.id)===entry.canonicalId&&g.sport===parent.sport))throw Error('FORECAST_EXPIRED');
   const detailKey=prefix+opts.parentReceiptId+'-event-'+opts.eventIndex+'-detail.json';
   let object=await env.ARCHIVE.get(detailKey),detail;
   if(object)detail=await object.json();else{
    if(!/^[a-z0-9-]{1,160}$/i.test(String(entry.event.id)))throw Error('PROVIDER_EVENT_ID_UNVERIFIED');
    const response=await boundedJson(fetchImpl,new URL('/v1/events/'+entry.event.id,POLY_US_API),12e6);detail=response.event;
    if(!detail||String(detail.id)!==String(entry.event.id)||!Array.isArray(detail.markets))throw Error('PROVIDER_EVENT_DETAIL_UNVERIFIED');
    const gameLines=detail.markets.filter(m=>['SPORTS_MARKET_TYPE_SPREAD','SPORTS_MARKET_TYPE_TOTAL'].includes(m.sportsMarketTypeV2)).length;
    const advertisedLines=detail.marketCounts?.numSpreadsAndTotalsMarkets;
    const gameLineProof=Number.isInteger(advertisedLines)&&advertisedLines===gameLines;
    const fullCountProof=Number.isInteger(detail.marketCounts?.numMarkets)&&detail.marketCounts.numMarkets===detail.markets.length;
    if(Number.isInteger(advertisedLines)?!gameLineProof:!fullCountProof)throw Error('PROVIDER_EVENT_MARKET_COUNT_MISMATCH');
    const mainIds=(entry.event.markets||[]).filter(m=>['SPORTS_MARKET_TYPE_MONEYLINE','SPORTS_MARKET_TYPE_DRAWABLE_OUTCOME'].includes(m.sportsMarketTypeV2)).map(m=>String(m.id||m.slug));
    const ids=new Set(detail.markets.map(m=>String(m.id||m.slug)));if(mainIds.some(id=>!ids.has(id)))throw Error('PROVIDER_MAIN_MARKET_MISSING');
    detail.enumerationProof={method:gameLineProof?'GAME_LINE_COUNTER_AND_MAIN_IDS':'FULL_MARKET_COUNTER',advertisedLines,gameLines,advertisedAll:detail.marketCounts?.numMarkets,returnedAll:detail.markets.length};
    await env.ARCHIVE.put(detailKey,JSON.stringify(detail));
   }
   scope={sport:parent.sport,slug:parent.slug};
   sourcePage={markets:detail.markets.slice(opts.offset,opts.offset+20),detailMarketCount:detail.markets.length};
   eventPage={events:[{...entry.event,markets:sourcePage.markets}]};
   canonicalBinding=entry.canonicalId;
  }else{
   const candidates=fixtures.filter(g=>g.sport===opts.sport);
   if(!candidates.length)return {ok:true,itemCount:0,bookBatches:0,nextOffset:null,reason:'NO_UPCOMING_INDEPENDENT_FORECASTS'};
   const url=new URL('/v1/events',POLY_US_API);
   for(const [k,v] of Object.entries({tagSlug:opts.slug,active:true,closed:false,startTimeMin:now.toISOString(),startTimeMax:new Date(now.getTime()+48*3600000).toISOString(),limit:20,offset:opts.offset,orderBy:'id',orderDirection:'asc'}))url.searchParams.set(k,String(v));
   sourcePage=eventPage=await boundedJson(fetchImpl,url);if(!Array.isArray(eventPage.events)||eventPage.events.length>20)throw Error('PROVIDER_PAGE_CHANGED');
  }
  const candidates=fixtures.filter(g=>g.sport===scope.sport).map(g=>({...g,league:({bun:'ger.1',lal:'esp.1'})[scope.slug]})),offers=[],events=[],unmatchedEvents=[];
  for(const event of eventPage.events){const match=canonicalBinding?{id:canonicalBinding,reason:'VERIFIED_PARENT_BINDING'}:matchPolymarketUsEvent(event,candidates,scope.sport);if(!match.id){unmatchedEvents.push({id:String(event.id),title:event.title||null,start:event.startTime||null,reason:match.reason});continue;}
   events.push({canonicalId:String(match.id),event});
   offers.push(...polymarketUsMarketOffers(event,scope.sport,{canonicalId:match.id,capturedAt:now.toISOString()})
    .filter(o=>valid(o.sourceMarketId)&&['moneyline','spread','total'].includes(o.marketFamily)&&o.raw?.contractLong===true&&o.raw.providerMarket?.closed!==true&&o.raw.providerMarket?.active!==false)
    .map(o=>({...o,raw:{...o.raw,canonicalSide:polymarketUsCanonicalSide(o,candidates.find(g=>String(g.id)===String(match.id)),({bun:'ger.1',lal:'esp.1'})[scope.slug]),sourceObservedAt:null,receiptId:opts.receiptId,contractBindingVerified:true}})));
  }
  const contracts=[...new Map(offers.map(o=>[o.sourceMarketId,o])).values()];
  for(const o of contracts){const no=o.sport!=='soccer'?o.raw.providerMarket?.marketSides?.find(s=>s.long===false):null;
   o.raw.opposite=no?{side:polymarketUsSideLabel(o.raw.providerMarket,no,o.sport),sourceOutcomeId:String(no.id||no.identifier||'')}:null;
  }
  const items=opts.operation==='markets'?sourcePage.markets:eventPage.events;
  const receipt={ok:true,operation:opts.operation,receiptId:opts.receiptId,slug:scope.slug,sport:scope.sport,capturedAt:now.toISOString(),itemCount:items.length,itemIds:items.map(e=>String(e.id||e.slug)),matchedEvents:events.length,contracts:contracts.length,
   unmatchedEvents,inventory:contracts.map(o=>({market:o.sourceMarketId,eventId:String(o.eventId),sport:o.sport})),
   matchedEventRefs:events.map((e,eventIndex)=>({eventIndex,eventId:e.canonicalId,gameId:e.event.gameId??null})),
   bookBatches:Math.ceil(contracts.length/4),nextOffset:items.length===20?opts.offset+20:null,offers:contracts,events,canAuthorizeWager:false};
  // Source page is private and immutable; normalized records are restricted to independently forecast games.
  await env.ARCHIVE.put(prefix+opts.receiptId+'-source.json',JSON.stringify(sourcePage));
  if(contracts.length){
   await persistNormalizedMarketBatch(env.DB,contracts,{snapshotType:'CURRENT',collectedAt:now.toISOString(),modelProbability:null});
   const roster=contracts.map(o=>({sport:o.sport,league:o.league,canonical_event_id:o.eventId,provider_event_id:o.raw.providerEventId,event_start_time:o.eventStart,home_team:o.homeTeam,away_team:o.awayTeam,market_family:o.marketFamily,side:o.side,canonical_side:o.raw.canonicalSide,line:o.line,period:o.period,source_market_id:o.sourceMarketId,source_outcome_id:o.sourceOutcomeId,collected_at:now.toISOString(),opposite:o.raw.opposite,fee_coefficient:o.raw.providerMarket?.feeCoefficient??null}));
   await env.ARCHIVE.put(`market-sources/polymarket-us/stream-roster/bootstrap-${scope.slug}-${opts.operation}-${opts.parentReceiptId||'events'}-${opts.eventIndex??0}-${opts.offset}.json`,JSON.stringify({version:1,source:'Polymarket US',capturedAt:now.toISOString(),roster}));
  }
  await env.ARCHIVE.put(key,JSON.stringify(receipt));
  return {...receipt,offers:undefined,events:undefined};
 }
 if(opts.operation!=='quotes'||!Number.isInteger(opts.batchIndex)||opts.batchIndex<0)throw Error('INVALID_OPERATION');
 const source=await env.ARCHIVE.get(key);if(!source)throw Error('UNKNOWN_RECEIPT');const receipt=await source.json();
 const doneKey=prefix+opts.receiptId+'-quotes-'+opts.batchIndex+'.json';const done=await env.ARCHIVE.get(doneKey);if(done)return {...await done.json(),replayed:true};
 if(now.getTime()-Date.parse(receipt.capturedAt)>30*60000||opts.batchIndex>=receipt.bookBatches)throw Error('EXPIRED_OR_INVALID_BATCH');
 const permitted=new Set(fixtures.map(g=>String(g.id)));const offers=[],errors=[],marketResults=[];
 await Promise.all(receipt.offers.slice(opts.batchIndex*4,opts.batchIndex*4+4).map(async offer=>{
  if(!permitted.has(String(offer.eventId))||Date.parse(offer.eventStart)<=now.getTime()){marketResults.push({market:offer.sourceMarketId,status:'FORECAST_EXPIRED'});return;}
  try{const body=await boundedJson(fetchImpl,new URL(`/v1/markets/${offer.sourceMarketId}/book`,POLY_US_API));const b=body.marketData;
   if(!b||b.marketSlug!==offer.sourceMarketId||!/^MARKET_STATE_[A-Z_]+$/.test(b.state||''))throw Error('BOOK_IDENTITY_OR_STATE_UNVERIFIED');
   const levels=xs=>(xs||[]).slice(0,20).map(l=>({price:Number(l.px?.value??l.px),quantity:Number(l.qty)})).filter(l=>l.price>0&&l.price<1&&l.quantity>0);
   const bids=levels(b.bids),asks=levels(b.offers);if(asks.length&&bids.length&&bids[0].price>asks[0].price)throw Error('INVALID_BOOK');
   const observed=b.transactTime&&Number.isFinite(Date.parse(b.transactTime))?new Date(b.transactTime).toISOString():null;
   offers.push({...offer,contractPrice:asks[0]?.price??null,fetchedAt:now.toISOString(),raw:{...offer.raw,bestBid:bids[0]?.price??null,bestAsk:asks[0]?.price??null,bids,offers:asks,marketState:b.state,sourceObservedAt:observed,quoteObservedAt:observed,quoteProvenance:'REST_BOOK',feeCoefficient:offer.raw.providerMarket?.feeCoefficient??null,canQualify:false,canAuthorizeWager:false}});
   if(offer.sport!=='soccer'&&offer.raw.opposite?.side&&offer.raw.opposite?.sourceOutcomeId&&bids.length){
    const yes=offers.at(-1),no=offer.raw.opposite;
    offers.push({...yes,side:no.side,sourceOutcomeId:no.sourceOutcomeId,contractPrice:1-bids[0].price,
     raw:{...yes.raw,contractLong:false,canonicalSide:yes.raw.canonicalSide==='home'?'away':yes.raw.canonicalSide==='away'?'home':null,providerOutcomeId:no.sourceOutcomeId,bestAsk:1-bids[0].price,bestBid:asks.length?1-asks[0].price:null,
      offers:bids.map(l=>({price:1-l.price,quantity:l.quantity})),bids:asks.map(l=>({price:1-l.price,quantity:l.quantity})),derivedFromVerifiedBinaryBook:true}});
   }
   marketResults.push({market:offer.sourceMarketId,status:'READY',marketState:b.state,buyAvailable:asks.length>0});
  }catch(e){marketResults.push({market:offer.sourceMarketId,status:'UNAVAILABLE',reason:e.message});errors.push({market:offer.sourceMarketId,reason:e.message});}
 }));
 const saved=offers.length?await persistNormalizedMarketBatch(env.DB,offers,{snapshotType:'CURRENT',collectedAt:new Date().toISOString(),modelProbability:null}):{inserted:0};
 const result={ok:errors.length===0,inserted:saved.inserted,errors,marketResults,canAuthorizeWager:false};await env.ARCHIVE.put(doneKey,JSON.stringify(result));return result;
}
