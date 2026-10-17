#!/usr/bin/env node
// Copy only. This runner has no production UPDATE/DELETE/DROP path.
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const source='b50c724c-903b-4241-8ce1-48d931e7a44c';
const out=process.env.ARCHIVE_OUTPUT||'/tmp/fbis-storage-archive';
const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
const max=Number(process.env.ARCHIVE_MAX_ROWS||2000);
const start=Number(process.env.ARCHIVE_START_ROWID||0);
if(!token||!account)throw Error('CREDENTIALS_REQUIRED');
if(!Number.isSafeInteger(max)||max<1||max>2000||!Number.isSafeInteger(start)||start<0)throw Error('INVALID_BOUNDED_SCOPE');
const hash=b=>createHash('sha256').update(b).digest('hex');
const quote=v=>v===null?'NULL':typeof v==='number'?(Number.isFinite(v)?String(v):(()=>{throw Error('NONFINITE');})()):"'"+String(v).replaceAll("'","''")+"'";
const base=`https://api.cloudflare.com/client/v4/accounts/${account}`;
const headers={Authorization:`Bearer ${token}`};
await mkdir(out,{recursive:true});
const evidence={contract:'fbis-research-archive-v1',startedAt:new Date().toISOString(),sourceDatabase:source,maxRows:max,startRowid:start,sourceRowsDeleted:0,sourceDbMutations:0,retentionReleaseAuthorized:false,completed:false};
async function api(path,body){
 const res=await fetch(base+path,{method:body?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});
 const data=await res.json();if(!res.ok||!data.success)throw Error('CLOUDFLARE_API_'+res.status);return data.result;
}
async function query(sql){
 if(!/^(SELECT|PRAGMA)\b/.test(sql))throw Error('PRODUCTION_READ_ONLY');
 const r=await api(`/d1/database/${source}/query`,{sql});
 if(r.some(x=>!x.success||x.meta?.changed_db||x.meta?.rows_written))throw Error('READ_ONLY_ASSERTION_FAILED');
 evidence.primaryPhysicalBytes=r[0].meta.size_after;return r[0].results;
}
async function r2read(key){
 const r=await fetch(base+'/r2/buckets/fbis-archive/objects/'+key,{headers,signal:AbortSignal.timeout(90000)});
 if(r.status===404)return null;if(!r.ok)throw Error('R2_READ_'+r.status);return Buffer.from(await r.arrayBuffer());
}
async function archive(key,bytes){
 const old=await r2read(key);
 if(old&&hash(old)!==hash(bytes))throw Error('CONTENT_COLLISION');
 if(!old){const r=await fetch(base+'/r2/buckets/fbis-archive/objects/'+key,{method:'PUT',headers:{...headers,'Content-Type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('R2_PUT_'+r.status);}
 const read=await r2read(key);if(!read||hash(read)!==hash(bytes)||read.length!==bytes.length)throw Error('R2_READBACK_MISMATCH');return read;
}
try{
 evidence.primaryStart=await api(`/d1/database/${source}`);
 const schema=(await query("SELECT sql FROM sqlite_master WHERE type='table' AND name='normalized_market_observations'"))[0].sql;
 const columns=(await query('PRAGMA table_info(normalized_market_observations)')).map(x=>x.name);
 if(columns.length!==50)throw Error('SCHEMA_DRIFT');
 const upper=(await query("SELECT MAX(rowid) upper FROM normalized_market_observations WHERE snapshot_type='RESEARCH'"))[0].upper;
 const rows=[];let cursor=start;
 while(rows.length<max){
  const page=await query(`SELECT CAST(rowid AS TEXT) __source_rowid,* FROM normalized_market_observations WHERE rowid>${cursor} AND rowid<=${Number(upper)} AND snapshot_type='RESEARCH' ORDER BY rowid LIMIT ${Math.min(50,max-rows.length)}`);
  if(!page.length)break;
  for(const row of page){if(row.snapshot_type!=='RESEARCH'||row.can_qualify||row.can_authorize_wager||row.decision_eligible||row.settled_at!==null)throw Error('INELIGIBLE_RESEARCH_ROW');}
  rows.push(...page);cursor=Number(page.at(-1).__source_rowid);
 }
 if(!rows.length)throw Error('EMPTY_COHORT');
 const packageBody=Buffer.from(JSON.stringify({contract:'fbis-lossless-market-cohort-v1',sourceDatabase:source,table:'normalized_market_observations',schema,columns,frozenUpperRowid:String(upper),rows}));
 const compressed=gzipSync(packageBody,{level:9});
 const digest=hash(compressed),name=`market-research-${digest}.json.gz`,key=`research/storage-recovery/market-research/${name}`;
 await writeFile(out+'/'+name,compressed);
 const downloaded=await archive(key,compressed);
 if(hash(gunzipSync(downloaded))!==hash(packageBody))throw Error('DECOMPRESSION_MISMATCH');
 await writeFile(out+'/restored-source.json',gunzipSync(downloaded));
 // Independent SQLite implementation recreates schema, rowids, nulls and all 50 fields.
 const py=spawnSync('python3',['-c',`import json,sqlite3,sys\np=json.load(open(sys.argv[1])); c=sqlite3.connect(':memory:'); c.execute(p['schema']); cols=p['columns']; q='INSERT INTO normalized_market_observations(rowid,'+','.join(cols)+') VALUES ('+','.join('?' for _ in range(51))+')'\nfor r in p['rows']: c.execute(q,[int(r['__source_rowid'])]+[r[k] for k in cols])\nassert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'\nc.row_factory=sqlite3.Row\na=[dict(r) for r in c.execute('SELECT CAST(rowid AS TEXT) __source_rowid,* FROM normalized_market_observations ORDER BY rowid')]\nassert a==p['rows'], 'FIELD_PARITY_FAILED'\nprint(json.dumps({'restoredRows':len(a),'columns':len(cols),'fullFieldParity':True,'integrity':'ok','engine':'isolated SQLite memory database'}))`,out+'/restored-source.json'],{encoding:'utf8'});
 if(py.status!==0)throw Error('INDEPENDENT_SQLITE_RESTORE_FAILED');
 evidence.restoration=JSON.parse(py.stdout);
 // Recheck exact frozen IDs, rather than assuming an unchanged count proves parity.
 const rechecked=[];
 for(let i=0;i<rows.length;i+=50){const ids=rows.slice(i,i+50).map(r=>quote(r.id)).join(',');rechecked.push(...await query(`SELECT CAST(rowid AS TEXT) __source_rowid,* FROM normalized_market_observations WHERE id IN (${ids}) ORDER BY rowid`));}
 rechecked.sort((a,b)=>Number(a.__source_rowid)-Number(b.__source_rowid));
 if(JSON.stringify(rechecked)!==JSON.stringify(rows))throw Error('SOURCE_CHANGED');
 evidence.archive={key,name,sha256:digest,bytes:compressed.length,uncompressedSha256:hash(packageBody),uncompressedBytes:packageBody.length,rows:rows.length,columns:columns.length,firstRowid:rows[0].__source_rowid,lastRowid:rows.at(-1).__source_rowid,r2DownloadVerified:true,sourceRecheckVerified:true};
 evidence.readerParity='NOT_QUALIFIED';evidence.remoteD1Restore='NOT_TESTED';evidence.driveBackup='PENDING_INDEPENDENT_UPLOAD_AND_DOWNLOAD';
 evidence.primaryEnd=await api(`/d1/database/${source}`);
 evidence.physicalBytesReclaimed=evidence.primaryStart.file_size-evidence.primaryEnd.file_size;
 evidence.completed=true;
 const manifest=Buffer.from(JSON.stringify(evidence,null,2)+'\n');const manifestName=`manifest-${hash(manifest)}.json`;
 await archive(`research/storage-recovery/market-research/${manifestName}`,manifest);
 await writeFile(out+'/'+manifestName,manifest);
}catch(error){evidence.error=error.message;process.exitCode=1;}
finally{await writeFile(out+'/result.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({completed:evidence.completed,rows:evidence.archive?.rows||0,sourceRowsDeleted:0,error:evidence.error||null}));}
