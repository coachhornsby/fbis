import {compactArchivedRaw} from "./polymarketPayloadArchive.js";
import {loadSoccerMarketFixtures} from "./soccerMarketFixtures.js";
/** Immutable paginated public discovery. Each page is archived before bounded ingestion. */
import {POLY_US_API,classifyPolymarketUsLeague,matchPolymarketUsEvent,polymarketUsMarketOffers} from './polymarketUs.js';
import {persistNormalizedMarketBatch} from './marketObservationLedger.js';
import {loadVerifiedTennisCandidates} from './polymarketTennisIdentity.js';
const PAGE=20,BATCH=100;
const key=id=>`market-sources/polymarket-us/receipts/${id}.json`;
const valid=id=>/^[a-z0-9-]{1,180}$/i.test(id||'');
async function hash(raw){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function capturePolymarketPage(env,{receiptId,kind,slug=null,sport=null,offset=0,fetchImpl=fetch,now=new Date()}={}){
 if(!valid(receiptId)||!Number.isSafeInteger(offset)||offset<0||offset%PAGE)throw Error('INVALID_PAGE_IDENTITY');
 if(!env.ARCHIVE?.get||!env.ARCHIVE?.put||!env.DB?.prepare)throw Error('DURABLE_STORAGE_REQUIRED');
 const previous=await env.ARCHIVE.get(key(receiptId));if(previous)return publicReceipt(await previous.json());
 if(kind!=='catalogue'&&kind!=='events')throw Error('INVALID_PAGE_KIND');
 if(kind==='events'&&(!valid(slug)||classifyPolymarketUsLeague({slug})!==sport))throw Error('INVALID_LEAGUE_SCOPE');
 const url=new URL(kind==='catalogue'?'/v2/leagues':`/v2/leagues/${slug}/events`,POLY_US_API);
 url.searchParams.set('limit',String(PAGE));url.searchParams.set('offset',String(offset));
 const response=await fetchImpl(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('PUBLIC_PROVIDER_HTTP_'+response.status);
 const raw=await response.text();
 const rawHash=await hash(raw),rawKey=`market-sources/polymarket-us/raw/${rawHash}.json`,capturedAt=now.toISOString();
 await env.ARCHIVE.put(rawKey,raw,{httpMetadata:{contentType:'application/json'}});
 const body=JSON.parse(raw),items=body[kind==='catalogue'?'leagues':'events'];
 if(!Array.isArray(items)||items.length>PAGE)throw Error('PROVIDER_PAGE_CONTRACT_CHANGED');
 let offers=[];
 if(kind==='events'){
  const starts=items.map(e=>Date.parse(e.startTime||e.eventDate||e.startDate||e.gameStartTime||'')).filter(Number.isFinite);
  // Tennis has a separate canonical official schedule; it is NOT in games.
  // Never fall back to old Action-only or Polymarket-only provisional IDs.
  const games=sport==='tennis'?
    await loadVerifiedTennisCandidates(env.DB,items.map(e=>e.startTime||e.eventDate||e.startDate||e.gameStartTime),{asOf:capturedAt}):
    starts.length?(await env.DB.prepare(`SELECT id,sport,start,home_name,away_name,home_abbr,away_abbr FROM games WHERE sport=? AND julianday(start) BETWEEN julianday(?) AND julianday(?)`)
    .bind(sport,new Date(Math.min(...starts)-7200000).toISOString(),new Date(Math.max(...starts)+7200000).toISOString()).all())?.results||[]:[];
  if(sport==='soccer')for(const g of (await loadSoccerMarketFixtures(env,{fetchImpl,now})).fixtures){const existing=games.find(x=>String(x.id)===g.id);if(existing)Object.assign(existing,g);else games.push(g);}
  for(const event of items){
   const match=matchPolymarketUsEvent(event,games,sport);
   offers.push(...polymarketUsMarketOffers(event,sport,{canonicalId:match.id,capturedAt,maxMarkets:Infinity}).map(offer=>({...offer,raw:{...offer.raw,
    receiptId,rawSnapshotKey:rawKey,providerLeagueSlug:slug,eventMatchStatus:match.reason,sourceObservedAt:null,quoteObservedAt:null}})));
  }
 }
 const receipt={receiptId,kind,slug,sport,offset,pageSize:PAGE,capturedAt,sourceUrl:url.toString(),rawHash,rawKey,
  itemIds:items.map(i=>String(i.id||i.slug||'')),itemCount:items.length,nextOffset:items.length===PAGE?offset+PAGE:null,
  leagues:kind==='catalogue'?items.map(l=>({slug:l.slug,name:l.name,sport:classifyPolymarketUsLeague(l)})):undefined,
  offers,batches:Math.ceil(offers.length/BATCH),expectedRows:offers.length,
  providerSnapshotAtomic:false,readOnly:true,canAuthorizeWager:false};
 await env.ARCHIVE.put(key(receiptId),JSON.stringify(receipt),{httpMetadata:{contentType:'application/json'}});
 return publicReceipt(receipt);
}
function publicReceipt({offers,...receipt}){return{ok:true,...receipt};}
export async function consumePolymarketPage(env,{receiptId,batchIndex}={}){
 if(!valid(receiptId)||!Number.isSafeInteger(batchIndex)||batchIndex<0)throw Error('INVALID_BATCH_IDENTITY');
 const stored=await env.ARCHIVE.get(key(receiptId));if(!stored)throw Error('RECEIPT_NOT_FOUND');
 const receipt=await stored.json();if(batchIndex>=receipt.batches)throw Error('BATCH_OUT_OF_RANGE');
 const originalOffers=receipt.offers.slice(batchIndex*BATCH,(batchIndex+1)*BATCH);
 const offers=[];
 for(const offer of originalOffers){const compact=await compactArchivedRaw(offer.raw,receipt);offers.push({...offer,raw:compact.raw});}
 const saved=await persistNormalizedMarketBatch(env.DB,offers,{snapshotType:'RESEARCH',collectedAt:receipt.capturedAt,modelProbability:null});
 return{ok:true,receiptId,batchIndex,expectedRows:offers.length,inserted:saved.inserted,canAuthorizeWager:false};
}
export async function reconcilePolymarketPage(env,{receiptId}={}){
 if(!valid(receiptId))throw Error('INVALID_RECEIPT_ID');
 const stored=await env.ARCHIVE.get(key(receiptId));if(!stored)throw Error('RECEIPT_NOT_FOUND');const receipt=await stored.json();
 const result=await env.DB.prepare(`SELECT COUNT(*) n FROM normalized_market_observations WHERE source='Polymarket US' AND json_valid(raw_payload_json) AND json_extract(raw_payload_json,'$.receiptId')=?`).bind(receiptId).first();
 const persistedRows=Number(result?.n||0),ok=persistedRows===receipt.expectedRows;
 const status={...publicReceipt(receipt),ok,persistedRows,reconciled:ok};
 await env.ARCHIVE.put(key(receiptId).replace('.json','-status.json'),JSON.stringify(status));return status;
}
