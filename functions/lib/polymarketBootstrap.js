import {POLY_US_API,classifyPolymarketUsLeague,fetchPolymarketUsLeagues,matchPolymarketUsEvent,polymarketUsMarketOffers} from './polymarketUs.js';
import {polymarketUsSideLabel} from './polymarketUs.js';
import {persistNormalizedMarketBatch} from './marketObservationLedger.js';
const valid=s=>/^[a-z0-9-]{1,160}$/i.test(s||'');
const prefix='market-sources/polymarket-us/bootstrap/';
export async function projectedPolymarketFixtures(db,now=new Date()){
 if(!db?.prepare)throw Error('PRIMARY_DB_REQUIRED');
 const end=new Date(now.getTime()+48*3600000).toISOString();
 const r=await db.prepare(`SELECT g.id,g.sport,g.start,g.home_name,g.away_name,g.home_abbr,g.away_abbr FROM games g
 WHERE julianday(g.start)>julianday(?1) AND julianday(g.start)<=julianday(?2) AND EXISTS (
 SELECT 1 FROM prediction_snapshots ps WHERE ps.game_id=g.id AND ps.sport=g.sport
 AND ps.model_version IS NOT NULL AND COALESCE(ps.projection_kind,'FBIS')<>'UNAVAILABLE'
 AND (ps.proj_total IS NOT NULL OR (ps.proj_home IS NOT NULL AND ps.proj_away IS NOT NULL) OR ps.p_home_final BETWEEN 0 AND 1)
 AND julianday(ps.frozen_at)<=julianday(?1) AND julianday(ps.frozen_at)<julianday(g.start))
 ORDER BY g.start LIMIT 400`).bind(now.toISOString(),end).all();
 return r.results||[];
}
async function boundedJson(fetchImpl,url){
 const r=await fetchImpl(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('POLYMARKET_PUBLIC_HTTP_'+r.status);
 const reader=r.body.getReader(),chunks=[];let bytes=0;
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>4e6)throw Error('PROVIDER_RESPONSE_TOO_LARGE');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
 const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder().decode(buffer));
}
export async function bootstrapPolymarket(env,opts={}, {fetchImpl=fetch,now=new Date()}={}){
 if(!env.ARCHIVE?.get||!env.ARCHIVE?.put)throw Error('PRIVATE_ARCHIVE_REQUIRED');
 const fixtures=await projectedPolymarketFixtures(env.DB,now);
 if(opts.operation==='catalogue'){
  if(!fixtures.length)return {ok:true,leagues:[],projectedFixtures:0,reason:'NO_UPCOMING_INDEPENDENT_FORECASTS',canAuthorizeWager:false};
  const catalogue=await fetchPolymarketUsLeagues(fetchImpl,{maxPages:8});
  const sports=new Set(fixtures.map(g=>g.sport));
  return {ok:true,leagues:catalogue.leagues.map(l=>({slug:l.slug,sport:classifyPolymarketUsLeague({slug:l.slug})})).filter(l=>sports.has(l.sport)),projectedFixtures:fixtures.length,catalogueComplete:catalogue.complete,canAuthorizeWager:false};
 }
 if(!valid(opts.receiptId))throw Error('INVALID_RECEIPT');
 const key=prefix+opts.receiptId+'.json';
 if(opts.operation==='page'){
  if(!valid(opts.slug)||classifyPolymarketUsLeague({slug:opts.slug})!==opts.sport||!Number.isInteger(opts.offset)||opts.offset<0||opts.offset>100||opts.offset%20)throw Error('INVALID_SCOPE');
  const existing=await env.ARCHIVE.get(key);if(existing){const old=await existing.json();return {...old,offers:undefined};}
  const candidates=fixtures.filter(g=>g.sport===opts.sport);
  if(!candidates.length)return {ok:true,itemCount:0,bookBatches:0,nextOffset:null,reason:'NO_UPCOMING_INDEPENDENT_FORECASTS'};
  const url=new URL('/v1/events',POLY_US_API);
  for(const [k,v] of Object.entries({tagSlug:opts.slug,active:true,closed:false,startTimeMin:now.toISOString(),startTimeMax:new Date(now.getTime()+48*3600000).toISOString(),limit:20,offset:opts.offset}))url.searchParams.set(k,String(v));
  const page=await boundedJson(fetchImpl,url);if(!Array.isArray(page.events)||page.events.length>20)throw Error('PROVIDER_PAGE_CHANGED');
  const offers=[];let matched=0;
  for(const event of page.events){const match=matchPolymarketUsEvent(event,candidates,opts.sport);if(!match.id)continue;matched++;
   offers.push(...polymarketUsMarketOffers(event,opts.sport,{canonicalId:match.id,capturedAt:now.toISOString(),maxMarkets:40})
    .filter(o=>valid(o.sourceMarketId)&&['moneyline','spread','total'].includes(o.marketFamily)&&o.raw?.contractLong===true)
    .map(o=>({...o,raw:{...o.raw,sourceObservedAt:null,receiptId:opts.receiptId,contractBindingVerified:true}})));
  }
  const contracts=[...new Map(offers.map(o=>[o.sourceMarketId,o])).values()];
  for(const o of contracts){const no=o.sport!=='soccer'?o.raw.providerMarket?.marketSides?.find(s=>s.long===false):null;
   o.raw.opposite=no?{side:polymarketUsSideLabel(o.raw.providerMarket,no,o.sport),sourceOutcomeId:String(no.id||no.identifier||'')}:null;
  }
  const receipt={ok:true,receiptId:opts.receiptId,slug:opts.slug,sport:opts.sport,capturedAt:now.toISOString(),itemCount:page.events.length,itemIds:page.events.map(e=>String(e.id)),matchedEvents:matched,contracts:contracts.length,
   bookBatches:Math.ceil(contracts.length/4),nextOffset:page.events.length===20?opts.offset+20:null,offers:contracts,canAuthorizeWager:false,coverageComplete:false};
  // Source page is private and immutable; normalized records are restricted to independently forecast games.
  await env.ARCHIVE.put(prefix+opts.receiptId+'-source.json',JSON.stringify(page));
  if(contracts.length){
   await persistNormalizedMarketBatch(env.DB,contracts,{snapshotType:'CURRENT',collectedAt:now.toISOString(),modelProbability:null});
   const roster=contracts.map(o=>({sport:o.sport,league:o.league,canonical_event_id:o.eventId,provider_event_id:o.raw.providerEventId,event_start_time:o.eventStart,home_team:o.homeTeam,away_team:o.awayTeam,market_family:o.marketFamily,side:o.side,line:o.line,period:o.period,source_market_id:o.sourceMarketId,source_outcome_id:o.sourceOutcomeId,collected_at:now.toISOString(),opposite:o.raw.opposite,fee_coefficient:o.raw.providerMarket?.feeCoefficient??null}));
   await env.ARCHIVE.put(`market-sources/polymarket-us/stream-roster/bootstrap-${opts.slug}-${opts.offset}.json`,JSON.stringify({version:1,source:'Polymarket US',capturedAt:now.toISOString(),roster}));
  }
  await env.ARCHIVE.put(key,JSON.stringify(receipt));
  return {...receipt,offers:undefined};
 }
 if(opts.operation!=='quotes'||!Number.isInteger(opts.batchIndex)||opts.batchIndex<0)throw Error('INVALID_OPERATION');
 const source=await env.ARCHIVE.get(key);if(!source)throw Error('UNKNOWN_RECEIPT');const receipt=await source.json();
 if(now.getTime()-Date.parse(receipt.capturedAt)>30*60000||opts.batchIndex>=receipt.bookBatches)throw Error('EXPIRED_OR_INVALID_BATCH');
 const doneKey=prefix+opts.receiptId+'-quotes-'+opts.batchIndex+'.json';const done=await env.ARCHIVE.get(doneKey);if(done)return done.json();
 const permitted=new Set(fixtures.map(g=>String(g.id)));const offers=[],errors=[];
 for(const offer of receipt.offers.slice(opts.batchIndex*4,opts.batchIndex*4+4)){
  if(!permitted.has(String(offer.eventId))||Date.parse(offer.eventStart)<=now.getTime())continue;
  try{const body=await boundedJson(fetchImpl,new URL(`/v1/markets/${offer.sourceMarketId}/book`,POLY_US_API));const b=body.marketData;
   if(!b||b.marketSlug!==offer.sourceMarketId||b.state!=='MARKET_STATE_OPEN')throw Error('BOOK_IDENTITY_OR_STATE_UNVERIFIED');
   const levels=xs=>(xs||[]).slice(0,20).map(l=>({price:Number(l.px?.value??l.px),quantity:Number(l.qty)})).filter(l=>l.price>0&&l.price<1&&l.quantity>0);
   const bids=levels(b.bids),asks=levels(b.offers);if(!asks.length||bids.length&&bids[0].price>asks[0].price)throw Error('INVALID_BOOK');
   const observed=b.transactTime&&Number.isFinite(Date.parse(b.transactTime))?new Date(b.transactTime).toISOString():null;
   offers.push({...offer,contractPrice:asks[0].price,fetchedAt:now.toISOString(),raw:{...offer.raw,bestBid:bids[0]?.price??null,bestAsk:asks[0].price,bids,offers:asks,marketState:b.state,sourceObservedAt:observed,quoteObservedAt:observed,quoteProvenance:'REST_BOOK',feeCoefficient:offer.raw.providerMarket?.feeCoefficient??null,canQualify:false,canAuthorizeWager:false}});
   if(offer.sport!=='soccer'&&offer.raw.opposite?.side&&offer.raw.opposite?.sourceOutcomeId&&bids.length){
    const yes=offers.at(-1),no=offer.raw.opposite;
    offers.push({...yes,side:no.side,sourceOutcomeId:no.sourceOutcomeId,contractPrice:1-bids[0].price,
     raw:{...yes.raw,contractLong:false,providerOutcomeId:no.sourceOutcomeId,bestAsk:1-bids[0].price,bestBid:1-asks[0].price,
      offers:bids.map(l=>({price:1-l.price,quantity:l.quantity})),bids:asks.map(l=>({price:1-l.price,quantity:l.quantity})),derivedFromVerifiedBinaryBook:true}});
   }
  }catch(e){errors.push({market:offer.sourceMarketId,reason:e.message});if(e.message.includes('429'))break;}
 }
 const saved=offers.length?await persistNormalizedMarketBatch(env.DB,offers,{snapshotType:'CURRENT',collectedAt:now.toISOString(),modelProbability:null}):{inserted:0};
 const result={ok:errors.length===0,inserted:saved.inserted,errors,canAuthorizeWager:false};await env.ARCHIVE.put(doneKey,JSON.stringify(result));return result;
}
