#!/usr/bin/env node
// Frozen source -> R2 -> independent SQLite -> isolated cold D1. No source DML.
import {gzipSync,gunzipSync} from 'node:zlib';
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {PRIMARY_DB,COLD_DB,sha,identifier,rowSql,assertRowsEqual} from './lib/storage-full-core.mjs';
const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!account||PRIMARY_DB===COLD_DB)throw Error('INVALID_CREDENTIALS_OR_TARGET');
const root='/tmp/fbis-full-storage',files=root+'/files',headers={Authorization:`Bearer ${token}`};
const base=`https://api.cloudflare.com/client/v4/accounts/${account}`,prefix='research/storage-recovery/full-20261017/';
const journalKey=prefix+'journal.json';
await mkdir(files,{recursive:true});
const config=root+'/cold-wrangler.json';
await writeFile(config,JSON.stringify({name:'fbis-cold-copy-only',compatibility_date:'2026-10-17',d1_databases:[{binding:'COLD',database_name:'fbis-cold-history-20261017',database_id:COLD_DB}]}));
async function request(path,body){
 let error;
 for(let attempt=0;attempt<4;attempt++){
  try{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});if(r.status===429||r.status>=500)throw Error('TRANSIENT_'+r.status);const b=await r.json();if(!r.ok||!b.success)throw Error('CF_API_'+r.status);return b.result;}catch(e){error=e;if(!/^TRANSIENT_|fetch failed|aborted|timeout/i.test(e.message))throw e;if(attempt<3)await new Promise(r=>setTimeout(r,1000*2**attempt));}
 }throw error;
}
async function query(db,sql){
 if(![PRIMARY_DB,COLD_DB].includes(db))throw Error('TARGET_OUT_OF_SCOPE');
 if(db===PRIMARY_DB&&!/^(SELECT|PRAGMA)\b/.test(sql))throw Error('PRIMARY_WRITE_PROHIBITED');
 const r=await request(`/d1/database/${db}/query`,{sql});
 if(r.some(x=>!x.success))throw Error('D1_QUERY_FAILED');
 if(db===PRIMARY_DB&&r.some(x=>x.meta.changed_db||x.meta.rows_written))throw Error('SOURCE_MUTATION_DETECTED');
 return r[0].results;
}
async function readObject(key){
 if(!key.startsWith(prefix)&&!/^market-sources\/polymarket-us\/(receipts|raw)\/[a-z0-9_.-]+\.json$/i.test(key))throw Error('R2_KEY_OUT_OF_SCOPE');
 const r=await fetch(base+'/r2/buckets/fbis-archive/objects/'+key,{headers,signal:AbortSignal.timeout(90000)});
 if(r.status===404)return null;if(!r.ok)throw Error('R2_READ_'+r.status);
 if(Number(r.headers.get('content-length'))>134217728)throw Error('R2_OBJECT_TOO_LARGE');
 const reader=r.body.getReader(),parts=[];let size=0;
 try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>134217728)throw Error('R2_OBJECT_TOO_LARGE');parts.push(Buffer.from(x.value));}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return Buffer.concat(parts);
}
async function storeObject(key,bytes){
 const previous=await readObject(key);
 if(previous&&sha(previous)!==sha(bytes))throw Error('IMMUTABLE_OBJECT_COLLISION');
 if(!previous){const r=await fetch(base+'/r2/buckets/fbis-archive/objects/'+key,{method:'PUT',headers,body:bytes,signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('R2_PUT_'+r.status);}
 const read=await readObject(key);if(!read||sha(read)!==sha(bytes)||read.length!==bytes.length)throw Error('R2_READBACK_FAILED');return read;
}
let journal;
const saved=await readObject(journalKey);
if(saved){journal=JSON.parse(saved);if(journal.contract!=='fbis-full-storage-copy-v1'||journal.sourceDb!==PRIMARY_DB||journal.coldDb!==COLD_DB)throw Error('JOURNAL_IDENTITY_FAILED');}
else journal={contract:'fbis-full-storage-copy-v1',sourceDb:PRIMARY_DB,coldDb:COLD_DB,startedAt:new Date().toISOString(),sourceDbMutations:0,sourceRowsDeleted:0,retentionReleaseAuthorized:false,completed:false,tables:[],dependencyObjects:[],readerParity:'NOT_QUALIFIED',driveVerification:'PENDING'};
async function checkpoint(){
 const body=Buffer.from(JSON.stringify(journal,null,2)+'\n');await writeFile(root+'/result.json',body);
 // Mutable resume pointer; accepted archive parts and final manifests stay immutable.
 const r=await fetch(base+'/r2/buckets/fbis-archive/objects/'+journalKey,{method:'PUT',headers,body,signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('JOURNAL_WRITE_FAILED');
 const b=await readObject(journalKey);if(!b||sha(b)!==sha(body))throw Error('JOURNAL_READBACK_FAILED');
 console.log(JSON.stringify({tables:journal.tables.map(t=>({table:t.name,verified:t.parts.reduce((s,p)=>s+p.rows,0),total:t.sourceRows})),dependencies:journal.dependencyObjects.length,completed:journal.completed}));
}
const deps=new Map(),sources=[{name:'normalized_market_observations',where:'1=1',columns:50},{name:'cfb_roster_observations',where:'season BETWEEN 2005 AND 2025',columns:27}];
function rememberDependencies(rows){
 for(const row of rows){if(!row.raw_payload_json)continue;let raw;try{raw=JSON.parse(row.raw_payload_json);}catch{continue;}
  if(!raw?.archiveRef)continue;const ref=raw.archiveRef;
  if(ref.version!=='polymarket-receipt-v1'||!/^market-sources\/polymarket-us\/receipts\/[a-z0-9-]{1,180}\.json$/i.test(ref.receiptKey)||! /^[a-f0-9]{64}$/.test(ref.originalPayloadHash))throw Error('UNSUPPORTED_PAYLOAD_REFERENCE');
  if(sha(row.raw_payload_json)!==row.raw_payload_hash)throw Error('STORED_REFERENCE_HASH_FAILED');
  if(!deps.has(ref.receiptKey))deps.set(ref.receiptKey,new Map());
  const identity=JSON.stringify([raw.providerMarketId,raw.providerOutcomeId,raw.rawSnapshotKey,raw.receiptId]);
  const hashes=deps.get(ref.receiptKey);if(!hashes.has(ref.originalPayloadHash))hashes.set(ref.originalPayloadHash,new Set());hashes.get(ref.originalPayloadHash).add(identity);
 }
}
async function localRestore(part,path){
 const result=spawnSync('python3',['scripts/storage-restore-part.py',path,root+'/rehearsal.sqlite'],{encoding:'utf8',maxBuffer:1024*1024});
 if(result.status!==0)throw Error('INDEPENDENT_SQLITE_RESTORE_FAILED');const r=JSON.parse(result.stdout);if(r.rows!==part.rows.length||!r.fullFieldParity)throw Error('SQLITE_PARITY_FAILED');
}
async function coldImport(table,columns,rows){
 const sqlPath=root+'/cold-part.sql';await writeFile(sqlPath,rowSql(table,columns,rows));
 const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','COLD','--remote','--config',config,'--file',sqlPath,'--yes','--json'],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:600000,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}});
 if(r.status!==0)throw Error('ISOLATED_COLD_IMPORT_FAILED_'+r.status);
 await unlink(sqlPath);
}
try{
 journal.primaryStartBytes??=(await request(`/d1/database/${PRIMARY_DB}`)).file_size;
 for(const spec of sources){
  let table=journal.tables.find(t=>t.name===spec.name);
  if(!table){
   const schema=(await query(PRIMARY_DB,`SELECT sql FROM sqlite_master WHERE type='table' AND name='${spec.name}'`))[0].sql;
   const columns=(await query(PRIMARY_DB,`PRAGMA table_info(${identifier(spec.name)})`)).map(x=>x.name);if(columns.length!==spec.columns)throw Error('SOURCE_SCHEMA_DRIFT');
   const bounds=(await query(PRIMARY_DB,`SELECT COUNT(*) n,MAX(rowid) upper FROM ${identifier(spec.name)} WHERE ${spec.where}`))[0];
   table={name:spec.name,where:spec.where,schema,columns,sourceRows:bounds.n,upperRowid:bounds.upper,parts:[]};journal.tables.push(table);await checkpoint();
  }
  await query(COLD_DB,table.schema.replace(/^CREATE TABLE(?: IF NOT EXISTS)? /,'CREATE TABLE IF NOT EXISTS '));
  const columns=(await query(COLD_DB,`PRAGMA table_info(${identifier(table.name)})`)).map(x=>x.name);if(JSON.stringify(columns)!==JSON.stringify(table.columns))throw Error('COLD_SCHEMA_DRIFT');
  let cursor=0;
  while(cursor<table.upperRowid){
   const old=table.parts.find(p=>p.afterRowid===cursor);let part,bytes,key,name;
   if(old){bytes=await readObject(old.key);if(!bytes||sha(bytes)!==old.sha256)throw Error('RESUME_PART_HASH_FAILED');part=JSON.parse(gunzipSync(bytes));key=old.key;name=old.name;}
   else{
    const rows=[];let pageCursor=cursor;
    while(rows.length<5000){const page=await query(PRIMARY_DB,`SELECT CAST(rowid AS TEXT) __source_rowid,* FROM ${identifier(table.name)} NOT INDEXED WHERE rowid>${pageCursor} AND rowid<=${table.upperRowid} AND (${table.where}) ORDER BY rowid LIMIT ${Math.min(500,5000-rows.length)}`);if(!page.length)break;rows.push(...page);pageCursor=Number(page.at(-1).__source_rowid);}
    if(!rows.length)break;
    part={contract:'fbis-full-cold-part-v1',sourceDb:PRIMARY_DB,table:table.name,schema:table.schema,columns:table.columns,afterRowid:cursor,upperRowid:table.upperRowid,rows};
    const body=Buffer.from(JSON.stringify(part));if(body.length>67108864)throw Error('PART_MEMORY_BUDGET_EXCEEDED');
    bytes=gzipSync(body,{level:9});name=table.name+'-'+sha(bytes)+'.json.gz';key=prefix+'parts/'+name;bytes=await storeObject(key,bytes);
   }
   if(part.sourceDb!==PRIMARY_DB||part.table!==table.name||part.afterRowid!==cursor||JSON.stringify(part.columns)!==JSON.stringify(table.columns))throw Error('PART_SCOPE_FAILED');
   await writeFile(files+'/'+name,bytes);await localRestore(part,files+'/'+name);
   if(!old?.coldVerified)await coldImport(table.name,table.columns,part.rows);
   const last=Number(part.rows.at(-1).__source_rowid),primaryRows=[],coldRows=[];
   for(let after=cursor;after<last;){
    const sql=`SELECT CAST(rowid AS TEXT) __source_rowid,* FROM ${identifier(table.name)} NOT INDEXED WHERE rowid>${after} AND rowid<=${last} AND (${table.where}) ORDER BY rowid LIMIT 500`;
    const a=await query(PRIMARY_DB,sql),b=await query(COLD_DB,sql);if(!a.length)break;assertRowsEqual(a,b,table.columns);primaryRows.push(...a);coldRows.push(...b);after=Number(a.at(-1).__source_rowid);
   }
   assertRowsEqual(part.rows,primaryRows,table.columns);assertRowsEqual(part.rows,coldRows,table.columns);rememberDependencies(part.rows);
   if(!old)table.parts.push({afterRowid:cursor,lastRowid:last,rows:part.rows.length,key,name,sha256:sha(bytes),bytes:bytes.length,coldVerified:true,sourceRechecked:true,sqliteVerified:true});
   cursor=last;
   const coldSize=(await request(`/d1/database/${COLD_DB}`)).file_size;if(coldSize>8000000000)throw Error('COLD_SHARD_HEADROOM_STOP');journal.coldPhysicalBytes=coldSize;await checkpoint();
  }
  const total=table.parts.reduce((s,p)=>s+p.rows,0);const sourceCount=(await query(PRIMARY_DB,`SELECT COUNT(*) n FROM ${identifier(table.name)} WHERE rowid<=${table.upperRowid} AND (${table.where})`))[0].n;const coldCount=(await query(COLD_DB,`SELECT COUNT(*) n FROM ${identifier(table.name)} WHERE rowid<=${table.upperRowid} AND (${table.where})`))[0].n;
  if(total!==table.sourceRows||sourceCount!==total||coldCount!==total)throw Error('FULL_TABLE_COUNT_FAILED');table.completed=true;await checkpoint();
 }
 const rawKeys=new Set();
 for(const [key,expected] of deps){
  const body=await readObject(key);if(!body)throw Error('DEPENDENCY_MISSING');const receipt=JSON.parse(body);
  if(!Array.isArray(receipt.offers)||!/^market-sources\/polymarket-us\/raw\/[a-f0-9]{64}\.json$/.test(receipt.rawKey))throw Error('DEPENDENCY_RECEIPT_INVALID');
  const found=new Map();for(const o of receipt.offers){if(!o.raw)continue;const digest=sha(JSON.stringify(o.raw)),identity=JSON.stringify([o.raw.providerMarketId,o.raw.providerOutcomeId,o.raw.rawSnapshotKey,o.raw.receiptId]);if(!found.has(digest))found.set(digest,new Set());found.get(digest).add(identity);}
  for(const [digest,identities] of expected){if(!found.has(digest))throw Error('ORIGINAL_PAYLOAD_HASH_MISSING');for(const identity of identities)if(!found.get(digest).has(identity))throw Error('ORIGINAL_PAYLOAD_IDENTITY_FAILED');}
  rawKeys.add(receipt.rawKey);await preserveDependency(key,body,expected.size);await checkpoint();
 }
 for(const key of rawKeys){const body=await readObject(key);if(!body||sha(body)!==key.match(/([a-f0-9]{64})\.json$/)[1])throw Error('RAW_SNAPSHOT_HASH_FAILED');await preserveDependency(key,body,0);await checkpoint();}
 for(const sql of ['CREATE INDEX IF NOT EXISTS idx_norm_market_event_time ON normalized_market_observations(sport,canonical_event_id,collected_at)','CREATE INDEX IF NOT EXISTS idx_norm_market_source ON normalized_market_observations(source,sport,market_family,collected_at)','CREATE INDEX IF NOT EXISTS idx_norm_market_snapshot ON normalized_market_observations(snapshot_type,sport,collected_at)','CREATE INDEX IF NOT EXISTS idx_cold_roster_season_team ON cfb_roster_observations(season,team_id)'])await query(COLD_DB,sql);
 const check=spawnSync('python3',['scripts/storage-restore-part.py','--check',root+'/rehearsal.sqlite'],{encoding:'utf8'});if(check.status!==0)throw Error('FINAL_SQLITE_INTEGRITY_FAILED');journal.independentSqlite=JSON.parse(check.stdout);
 journal.primaryEndBytes=(await request(`/d1/database/${PRIMARY_DB}`)).file_size;journal.coldPhysicalBytes=(await request(`/d1/database/${COLD_DB}`)).file_size;journal.completed=true;journal.finishedAt=new Date().toISOString();
 const manifest=Buffer.from(JSON.stringify(journal,null,2)+'\n'),manifestName='full-manifest-'+sha(manifest)+'.json';await storeObject(prefix+manifestName,manifest);await writeFile(files+'/'+manifestName,manifest);await checkpoint();
 const pack=spawnSync('python3',['scripts/storage-pack-blocks.py',files,root+'/drive-blocks'],{encoding:'utf8'});if(pack.status!==0)throw Error('DRIVE_BLOCK_PACK_FAILED');console.log(pack.stdout.trim());
}catch(error){journal.error=error.message;journal.completed=false;await checkpoint();process.exitCode=1;}
async function preserveDependency(sourceKey,body,verifiedOriginalHashes){
 const digest=sha(body),name='dependency-'+digest+'.bin.gz',key=prefix+'dependencies/'+name;
 const compressed=await storeObject(key,gzipSync(body,{level:9}));if(sha(gunzipSync(compressed))!==digest)throw Error('DEPENDENCY_RESTORE_FAILED');await writeFile(files+'/'+name,compressed);
 if(!journal.dependencyObjects.some(d=>d.sourceKey===sourceKey))journal.dependencyObjects.push({sourceKey,sourceSha256:digest,sourceBytes:body.length,key,name,sha256:sha(compressed),bytes:compressed.length,verifiedOriginalHashes});
}
