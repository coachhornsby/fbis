/** One-shot lossless migration: existing R2 bodies, D1 REST, exact source hashes. */
import {writeFile} from 'node:fs/promises';
import {compactArchivedRaw,payloadHash,restoreArchivedRaw,receiptKey} from '../functions/lib/polymarketPayloadArchive.js';
import {sqlQuote as quote,compactUpdateSql} from './lib/polymarket-storage-sql.mjs';
import {getArchivedReceipt} from './lib/archived-receipt-retry.mjs';
import {compactionBudget,compactionPageLimit} from './lib/storage-compaction-budget.mjs';
const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID,secret=process.env.HARVEST_SECRET;
if(!token||!account||!secret)throw Error('Existing Cloudflare and harvest credentials required');
const cutoff=process.env.COMPACTION_CUTOFF||new Date().toISOString();
if(!Number.isFinite(Date.parse(cutoff)))throw Error('Invalid cutoff');
const api=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/b50c724c-903b-4241-8ce1-48d931e7a44c/query`;
const result={cutoff,completed:false,examined:0,updated:0,bytesRemoved:0,restoreChecks:0,reasons:{},newArchiveObjects:0,deletedRows:0};
const budget=compactionBudget({startRowid:process.env.COMPACTION_START_ROWID||0,maxRows:process.env.COMPACTION_MAX_ROWS||5000});
let cursor=budget.startRowid,batches=0;
result.startRowid=cursor;result.maxRows=budget.maxRows;result.paused=false;
async function query(sql){
 for(let i=0;i<8;i++){
  try{
   const r=await fetch(api,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({sql}),signal:AbortSignal.timeout(60000)});
   const v=await r.json();if(!r.ok||!v.success||v.result?.some(x=>x.success===false))throw Error('D1_REST_'+r.status+'_'+(v.errors?.[0]?.code||'QUERY_FAILED'));
   return v.result;
  }catch(e){if(i===7)throw e;await new Promise(r=>setTimeout(r,Math.min(15000,1000*2**i)));}
 }
}
const cache=new Map();
const identity=raw=>JSON.stringify([raw.providerMarketId,raw.providerOutcomeId]);
async function receipt(id){
 const key=receiptKey(id);if(cache.has(key))return cache.get(key);
 const value=await getArchivedReceipt({url:'https://fbis-myz.pages.dev/api/polymarket-storage',headers:{'content-type':'application/json','x-harvest-secret':secret},body:JSON.stringify({operation:'receipt',receiptId:id})});
 if(value===null){cache.set(key,null);return null;}
 const byIdentity=new Map();
 for(const offer of value.offers||[]){if(!offer?.raw)continue;const k=identity(offer.raw);if(!byIdentity.has(k))byIdentity.set(k,[]);byIdentity.get(k).push(offer);}
 const entry={receiptId:value.receiptId,rawKey:value.rawKey,byIdentity};
 if(cache.size>=2)cache.delete(cache.keys().next().value);cache.set(key,entry);return entry;
}
async function source(raw){
 const r=await receipt(raw.receiptId);return r?{receiptId:r.receiptId,rawKey:r.rawKey,offers:r.byIdentity.get(identity(raw))||[]}:null;
}
async function save(){result.batches=batches;result.nextCursor=cursor;await writeFile('/tmp/fbis-polymarket-storage-result.json',JSON.stringify(result,null,2));}
try{
 const upper=(await query(`SELECT MAX(rowid) upper_rowid FROM normalized_market_observations INDEXED BY idx_norm_market_source WHERE source='Polymarket US' AND collected_at<=${quote(cutoff)}`))[0].results[0].upper_rowid||0;
 result.upperRowid=upper;
 while(true){
  const pageLimit=compactionPageLimit(result.examined,budget.maxRows);
  if(!pageLimit){result.paused=true;break;}
  const rows=(await query(`SELECT rowid storage_rowid,id,CASE WHEN json_extract(raw_payload_json,'$.archiveRef.version')='polymarket-receipt-v1' THEN NULL ELSE raw_payload_json END raw_payload_json,raw_payload_hash FROM normalized_market_observations NOT INDEXED WHERE rowid>${cursor} AND rowid<=${upper} AND source='Polymarket US' AND collected_at<=${quote(cutoff)} AND length(raw_payload_json)<=65536 ORDER BY rowid LIMIT ${pageLimit}`))[0].results;
  if(!rows.length)break;
  const updates=[];
  for(const row of rows){
   if(row.raw_payload_json===null){result.reasons.ALREADY_COMPACT=(result.reasons.ALREADY_COMPACT||0)+1;continue;}
   const raw=JSON.parse(row.raw_payload_json);let reason=null;
   if(raw.archiveRef)reason='ALREADY_COMPACT';
   else if(!raw.receiptId||!raw.rawSnapshotKey)reason='NO_ARCHIVE_REFERENCE';
   else{
    const archive=await source(raw);
    if(!archive)reason='ARCHIVE_UNAVAILABLE';
    else{
     const value=await compactArchivedRaw(raw,archive,{originalHash:row.raw_payload_hash});
     if(!value.changed)reason=value.reason;
     else{const text=JSON.stringify(value.raw),hash=await payloadHash(text);updates.push({id:row.id,oldHash:row.raw_payload_hash,text,hash,originalHash:value.originalHash,saved:Buffer.byteLength(row.raw_payload_json)-Buffer.byteLength(text)});}
    }
   }
   if(reason)result.reasons[reason]=(result.reasons[reason]||0)+1;
  }
  let proof=null;
  for(let i=0;i<updates.length;i+=500){
   const group=updates.slice(i,i+500);
   const sql=group.map(compactUpdateSql).join('\n');
   const written=await query(sql);
   if(written.length!==group.length)throw Error('D1_RESULT_ALIGNMENT_MISMATCH');
   for(let j=0;j<written.length;j++){if(Number(written[j].meta?.changes||0)){result.updated++;result.bytesRemoved+=group[j].saved;proof??=group[j];}}
  }
  if(proof&&(result.restoreChecks===0||batches%25===0)){
   const stored=(await query(`SELECT raw_payload_json,raw_payload_hash FROM normalized_market_observations WHERE id=${quote(proof.id)}`))[0].results[0];
   const raw=JSON.parse(stored.raw_payload_json),archived=await source(raw);
   const restored=await restoreArchivedRaw(raw,{get:async()=>({json:async()=>archived})},{storedHash:stored.raw_payload_hash});
   if(await payloadHash(restored)!==proof.originalHash)throw Error('RESTORED_SOURCE_HASH_MISMATCH');result.restoreChecks++;
  }
  result.examined+=rows.length;cursor=rows.at(-1).storage_rowid;batches++;await save();
  if(result.examined>1000000)throw Error('COMPACTION_ROW_BUDGET_EXCEEDED');
  if(batches%25===0)console.log(JSON.stringify(result));
 }
 await query('CREATE INDEX IF NOT EXISTS idx_norm_market_player ON normalized_market_observations(sport,canonical_player_id,stat_family,collected_at) WHERE canonical_player_id IS NOT NULL');
 // Snapshot-only index was retired by migration 0116 for primary headroom.
 const indexes=(await query("SELECT name FROM sqlite_schema WHERE type='index' AND name='idx_norm_market_player'"))[0].results;
 if(indexes.length!==1)throw Error('INDEX_RESTORATION_INCOMPLETE');
 result.indexesRestored=true;result.completed=!result.paused;
}catch(e){result.error=String(e.message);throw e;}
finally{await save();console.log(JSON.stringify(result));}
