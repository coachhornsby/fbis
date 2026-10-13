import {normalizePinnoddsMarkets} from './pinnoddsMarkets.js';
import {persistNormalizedMarketBatch} from './marketObservationLedger.js';
const root='market-sources/pinnodds',valid=id=>/^[a-z0-9-]{1,180}$/i.test(id||''),batchSize=100;
async function source(env,snapshotId){
 if(!valid(snapshotId))throw Error('INVALID_SNAPSHOT_ID');
 const object=await env.ARCHIVE.get(`${root}/receipts/${snapshotId}.json`);if(!object)throw Error('PROVIDER_RECEIPT_NOT_FOUND');
 const receipt=await object.json();if(receipt.ok!==true)throw Error('PROVIDER_CAPTURE_INCOMPLETE');return receipt;
}
export async function preparePinnoddsSnapshot(env,{snapshotId}={}){
 const receipt=await source(env,snapshotId),normalizedKey=`${root}/normalized/${snapshotId}.json`,prior=await env.ARCHIVE.get(normalizedKey);if(prior){const {rows,...result}=await prior.json();return{ok:true,...result};}
 const object=await env.ARCHIVE.get(receipt.rawKey);if(!object)throw Error('RAW_SNAPSHOT_NOT_FOUND');
 const body=await object.json();let result={rows:[],reasons:{},inputEvents:0,normalizedRows:0,matchedRows:0};
 if(receipt.kind==='board'){
  const starts=body.events.map(e=>Date.parse(e.starts||'')).filter(Number.isFinite);
  const games=starts.length?(await env.DB.prepare(`SELECT id,sport,start,home_name,away_name,home_abbr,away_abbr FROM games WHERE julianday(start) BETWEEN julianday(?) AND julianday(?)`)
    .bind(new Date(Math.min(...starts)-7200000).toISOString(),new Date(Math.max(...starts)+7200000).toISOString()).all())?.results||[]:[];
  result=normalizePinnoddsMarkets(body,{sportId:receipt.sportId,feed:receipt.feed,capturedAt:receipt.collectedAt,games,snapshotId,rawKey:receipt.rawKey});
 }
 const prepared={...receipt,...result,batchSize,batches:Math.ceil(result.rows.length/batchSize)};
 await env.ARCHIVE.put(normalizedKey,JSON.stringify(prepared),{httpMetadata:{contentType:'application/json'}});
 const {rows,...publicResult}=prepared;return{ok:true,...publicResult};
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
