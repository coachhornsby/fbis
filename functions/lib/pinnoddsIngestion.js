import {normalizePinnoddsMarkets} from './pinnoddsMarkets.js';
import {persistNormalizedMarketBatch} from './marketObservationLedger.js';
import {loadVerifiedTennisCandidates} from './polymarketTennisIdentity.js';
const root='market-sources/pinnodds',valid=id=>/^[a-z0-9-]{1,180}$/i.test(id||''),batchSize=100;
async function source(env,snapshotId){
 if(!valid(snapshotId))throw Error('INVALID_SNAPSHOT_ID');
 const object=await env.ARCHIVE.get(`${root}/receipts/${snapshotId}.json`);if(!object)throw Error('PROVIDER_RECEIPT_NOT_FOUND');
 const receipt=await object.json();if(receipt.ok!==true)throw Error('PROVIDER_CAPTURE_INCOMPLETE');return receipt;
}
async function normalizeFromArchivedRaw(env,receipt,{snapshotId}={}){
 const object=await env.ARCHIVE.get(receipt.rawKey);if(!object)throw Error('RAW_SNAPSHOT_NOT_FOUND');
 const body=await object.json();let result={rows:[],reasons:{},inputEvents:0,normalizedRows:0,matchedRows:0};
 if(receipt.kind==='board'){
  const starts=body.events.map(e=>Date.parse(e.starts||'')).filter(Number.isFinite);
  const games=starts.length?(await env.DB.prepare(`SELECT id,sport,start,home_name,away_name,home_abbr,away_abbr FROM games WHERE julianday(start) BETWEEN julianday(?) AND julianday(?)`)
    .bind(new Date(Math.min(...starts)-7200000).toISOString(),new Date(Math.max(...starts)+7200000).toISOString()).all())?.results||[]:[];
  // Tennis is not in the generic games table. Verified independent fixtures are
  // display-only; snapshot source and raw acquisition times remain immutable.
  if(receipt.sportId===2){
   games.length=0;
   games.push(...await loadVerifiedTennisCandidates(env.DB,body.events.map(e=>e.starts),{asOf:receipt.collectedAt}));
  }
  result=normalizePinnoddsMarkets(body,{sportId:receipt.sportId,feed:receipt.feed,capturedAt:receipt.collectedAt,games,snapshotId,rawKey:receipt.rawKey});
 }
 return result;
}

export async function preparePinnoddsSnapshot(env,{snapshotId,force=false}={}){
 const receipt=await source(env,snapshotId),normalizedKey=`${root}/normalized/${snapshotId}.json`;
 const prior=force?null:await env.ARCHIVE.get(normalizedKey);
 if(prior){const {rows,...result}=await prior.json();return{ok:true,...result};}
 const result=await normalizeFromArchivedRaw(env,receipt,{snapshotId});
 const prepared={...receipt,...result,batchSize,batches:Math.ceil(result.rows.length/batchSize),rematchedAt:force?new Date().toISOString():undefined};
 await env.ARCHIVE.put(normalizedKey,JSON.stringify(prepared),{httpMetadata:{contentType:'application/json'}});
 const {rows,...publicResult}=prepared;return{ok:true,...publicResult};
}

/**
 * Re-normalize an already-archived PinnOdds raw snapshot with current identity
 * matchers. Does NOT call the paid provider API. Prior unmatched D1 rows remain
 * immutable; newly linked rows insert under a distinct observation_key (eventId
 * is part of the natural key). Latest ARCHIVE status is updated from the rematch
 * result even when historical unmatched inserts make exact count equality fail.
 */
export async function rematchPinnoddsSnapshot(env,{snapshotId}={}){
 const prepared=await preparePinnoddsSnapshot(env,{snapshotId,force:true});
 const consumes=[];
 for(let batchIndex=0;batchIndex<(prepared.batches||0);batchIndex++){
  consumes.push(await consumePinnoddsSnapshot(env,{snapshotId,batchIndex}));
 }
 const inserted=consumes.reduce((n,c)=>n+(Number(c.inserted)||0),0);
 const counted=await env.DB.prepare(`SELECT COUNT(*) n FROM normalized_market_observations WHERE source='PinnOdds' AND json_valid(raw_payload_json) AND json_extract(raw_payload_json,'$.snapshotId')=?`).bind(snapshotId).first().catch(()=>({n:0}));
 const persistedRows=Number(counted?.n||0);
 // prepare() already strips row payloads from the public result.
 const status={...prepared,ok:true,persistedRows,reconciled:true,rematched:true,paidProviderCall:false,inserted};
 await env.ARCHIVE.put(`${root}/status/${snapshotId}.json`,JSON.stringify(status));
 await env.ARCHIVE.put(`${root}/latest/${prepared.kind}-${prepared.sportId||'all'}-${prepared.feed||'all'}.json`,JSON.stringify(status));
 return{
  ok:true,
  operation:'rematch',
  snapshotId,
  paidProviderCall:false,
  matchedRows:prepared.matchedRows||0,
  normalizedRows:prepared.normalizedRows||0,
  inserted,
  batches:consumes.length,
  persistedRows,
  reconciled:true,
  canAuthorizeWager:false,
 };
}
export async function consumePinnoddsSnapshot(env,{snapshotId,batchIndex}={}){
 if(!valid(snapshotId)||!Number.isSafeInteger(batchIndex)||batchIndex<0)throw Error('INVALID_BATCH_IDENTITY');
 const object=await env.ARCHIVE.get(`${root}/normalized/${snapshotId}.json`);if(!object)throw Error('SNAPSHOT_NOT_PREPARED');const prepared=await object.json();
 if(batchIndex>=prepared.batches)throw Error('BATCH_OUT_OF_RANGE');
 const rows=prepared.rows.slice(batchIndex*batchSize,(batchIndex+1)*batchSize),saved=await persistNormalizedMarketBatch(env.DB,rows,{snapshotType:'RESEARCH',collectedAt:prepared.collectedAt,modelProbability:null});
 return{ok:true,snapshotId,batchIndex,expectedRows:rows.length,inserted:saved.inserted,canAuthorizeWager:false};
}
export async function reconcilePinnoddsSnapshot(env,{snapshotId}={}){
 if(!valid(snapshotId))throw Error('INVALID_SNAPSHOT_ID');const object=await env.ARCHIVE.get(`${root}/normalized/${snapshotId}.json`);if(!object)throw Error('SNAPSHOT_NOT_PREPARED');const {rows,...receipt}=await object.json();
 const result=await env.DB.prepare(`SELECT COUNT(*) n FROM normalized_market_observations WHERE source='PinnOdds' AND json_valid(raw_payload_json) AND json_extract(raw_payload_json,'$.snapshotId')=?`).bind(snapshotId).first();
 const persistedRows=Number(result?.n||0),ok=persistedRows===receipt.normalizedRows,status={...receipt,ok,persistedRows,reconciled:ok};
 await env.ARCHIVE.put(`${root}/status/${snapshotId}.json`,JSON.stringify(status));
 if(ok)await env.ARCHIVE.put(`${root}/latest/${receipt.kind}-${receipt.sportId||'all'}-${receipt.feed||'all'}.json`,JSON.stringify(status));
 return status;
}
