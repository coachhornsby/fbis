#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
const map={PRIMARY:'b50c724c-903b-4241-8ce1-48d931e7a44c',LEGACY:'c32ccf06-c896-4d24-bb89-3e87a7412899',Q4:'e8b0b65d-90a6-4842-8ee7-0f85d75afb4c',Q4B:'bb240435-e227-43e9-b8a6-eb05f0c68d4c'};
const label=process.env.RETIRED_HISTORY_DB;
const db=map[label],account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const batch=Number(process.env.RETIRED_BATCH||250),cap=Number(process.env.RETIRED_CAP||1200);
const where="sport IN ('soccer','wnba','npb','kbo')";
if(!db||!account||!token||!Number.isSafeInteger(batch)||batch<1||batch>500||!Number.isSafeInteger(cap)||cap<1||cap>2000)throw Error('INVALID_CONFIG');
const root='https://api.cloudflare.com/client/v4/accounts/'+account;
const hash=s=>createHash('sha256').update(s).digest('hex');
const out='/tmp/retired-market-'+label+'.json';
const log={contract:'fbis-retired-market-reclamation-v1',db:label,source:db,retired:['soccer','wnba','npb','kbo'],deleted:0,archived:0,batches:0,objects:[],errors:[],completed:false,createdAt:new Date().toISOString()};
async function get(path,opts){
 const r=await fetch(root+path,{...opts,headers:{Authorization:'Bearer '+token,...(opts?.headers||{})},signal:AbortSignal.timeout(160000)});
 if(!r.ok)throw Error('CLOUDFLARE_HTTP_'+r.status+'_'+(await r.text()).slice(0,250));
 return r;
}
async function query(sql){
 const v=await(await get('/d1/database/'+db+'/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql})})).json();
 if(!v.success||v.result?.[0]?.success!==true)throw Error('D1_FAILED_'+JSON.stringify(v.errors));
 return v.result[0];
}
async function write(){await writeFile(out,JSON.stringify(log,null,2)+'\n');}
try{
 await mkdir('/tmp',{recursive:true});
 const schema=(await query("SELECT sql FROM sqlite_master WHERE type='table' AND name='normalized_market_observations'")).results[0]?.sql;
 if(!schema?.includes('observation_key'))throw Error('INVALID_MARKET_TABLE');
 const before=await(await get('/d1/database/'+db)).json();log.sizeBefore=before.result?.file_size;
 for(let i=0;i<cap;i++){
  const rows=(await query('SELECT rowid AS source_rowid,* FROM normalized_market_observations WHERE '+where+' ORDER BY rowid LIMIT '+batch)).results;
  if(!rows.length){log.completed=true;break;}
  const ids=rows.map(x=>x.source_rowid);
  if(ids.some(x=>!Number.isSafeInteger(x)||x<1)||rows.some(x=>!['soccer','wnba','npb','kbo'].includes(x.sport)))throw Error('OUT_OF_SCOPE_ROW');
  const body=JSON.stringify({contract:'fbis-retired-sport-row-archive-v1',source_database:db,table:'normalized_market_observations',schema,rows,source_rows_deleted_before_archive:0});
  const digest=hash(body),key='retired-sports/2026-10-26/market-history/'+label+'/sha256-'+digest+'.json';
  const path='/r2/buckets/fbis-archive/objects/'+key;
  await get(path,{method:'PUT',headers:{'content-type':'application/json'},body});
  const restored=await(await get(path)).text();
  if(hash(restored)!==digest)throw Error('R2_RESTORATION_MISMATCH');
  const recheck=(await query('SELECT rowid AS source_rowid,* FROM normalized_market_observations WHERE rowid IN ('+ids.join(',')+') ORDER BY rowid')).results;
  if(hash(JSON.stringify(rows))!==hash(JSON.stringify(recheck)))throw Error('SOURCE_CHANGED_SINCE_ARCHIVE');
  const deleted=await query('DELETE FROM normalized_market_observations WHERE '+where+' AND rowid IN ('+ids.join(',')+')');
  if(Number(deleted.meta.changes)!==rows.length)throw Error('DELETE_COUNT_NOT_EQUAL_TO_ARCHIVED');
  log.deleted+=rows.length;log.archived+=rows.length;log.batches++;
  log.lastObject={key,sha256:digest,rows:rows.length};
  if(i%10===0)await write();
 }
 const after=await(await get('/d1/database/'+db)).json();log.sizeAfter=after.result?.file_size;
 log.bytesReclaimed=log.sizeBefore-log.sizeAfter;
 log.remaining=(await query('SELECT sport,COUNT(*) n FROM normalized_market_observations WHERE '+where+' GROUP BY sport')).results;
}catch(e){log.errors.push(String(e.message||e));}
finally{log.finishedAt=new Date().toISOString();await write();console.log(JSON.stringify(log));if(log.errors.length||!log.completed)process.exitCode=1;}
