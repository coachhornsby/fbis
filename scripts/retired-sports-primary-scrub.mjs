#!/usr/bin/env node
// Bounded production retirement: SHA-verified full-record R2 copy precedes every D1 DELETE.
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';

const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const db='b50c724c-903b-4241-8ce1-48d931e7a44c',bucket='fbis-archive';
const root='retired-sports/2026-10-26/PRIMARY';
const apply=process.env.RETIRED_SPORT_APPLY==='true';
const release=process.env.RETIRED_SPORT_RELEASE_ID||'';
const limit=Math.min(800,Number(process.env.RETIRED_SPORT_BATCH_ROWS||'500'));
const budget=Math.min(1200,Number(process.env.RETIRED_SPORT_MAX_BATCHES||'600'));
if(!account||!token)throw Error('CLOUDFLARE_CREDENTIALS_REQUIRED');
if(!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(budget)||budget<1)throw Error('INVALID_BUDGET');
if(apply&&!/^retired-20261026-[a-z0-9_-]{6,}$/.test(release))throw Error('APPLY_RELEASE_REQUIRED');
const base='https://api.cloudflare.com/client/v4/accounts/'+account;
const sha=x=>createHash('sha256').update(x).digest('hex');
const result={contract:'fbis-retired-sport-primary-scrub-v1',releaseId:apply?release:'DRY_RUN',apply,
  startedAt:new Date().toISOString(),rowsArchivedAndDeleted:0,batches:0,tables:[],blockers:[],
  sourceDb:db,retired:['soccer','wnba','npb','kbo'],protected:['nfl','mlb','nba','nhl','cfb','cbb','tennis'],
  modelAuthorityChanged:false,wagerAuthorityChanged:false,completed:false};
await mkdir('/tmp/fbis-retired-sport-scrub',{recursive:true});
async function request(path,opts={}){
  const r=await fetch(base+path,{...opts,headers:{authorization:'Bearer '+token,...opts.headers},
    signal:AbortSignal.timeout(180000)});
  if(!r.ok)throw Error('CLOUDFLARE_HTTP_'+r.status+' '+(await r.text()).slice(0,350));
  return r;
}
async function sql(statement){
  const r=await request('/d1/database/'+db+'/query',{method:'POST',
    headers:{'content-type':'application/json'},body:JSON.stringify({sql:statement})});
  const d=await r.json();
  if(!d.success||!d.result?.[0]?.success)throw Error('D1_FAILED '+JSON.stringify(d.errors||d.result?.[0]?.error));
  return {rows:d.result[0].results||[],meta:d.result[0].meta||{}};
}
async function archive(table,schema,rows){
  const body=JSON.stringify({contract:'fbis-retired-sport-row-archive-v1',
    source_database:db,table,schema,rows,source_rows_deleted_before_archive:0});
  const hash=sha(body),key=root+'/'+table+'/sha256-'+hash+'.json',path='/r2/buckets/'+bucket+'/objects/'+key;
  await request(path,{method:'PUT',headers:{'content-type':'application/json'},body});
  const reloaded=await(await request(path)).text();
  if(sha(reloaded)!==hash)throw Error('R2_SHA256_READBACK_FAILED');
  const o=JSON.parse(reloaded);
  if(o.table!==table||o.schema!==schema||o.rows?.length!==rows.length||o.source_database!==db)
    throw Error('R2_FULL_RECORD_RESTORE_FAILED');
  return{key,hash};
}
async function receipt(){await writeFile('/tmp/fbis-retired-sport-scrub/result.json',JSON.stringify(result,null,2)+'\n');}
function childrenFirst(tables){
  const refs=new Map(tables.map(t=>[t.name,new Set(
    [...String(t.sql||'').matchAll(/\bREFERENCES\s+["']?([a-z0-9_]+)/gi)].map(x=>x[1]))]));
  const remaining=new Map(tables.map(t=>[t.name,t])),ordered=[];
  while(remaining.size){
    const ready=[...remaining.values()].find(t=>![...remaining.keys()].some(other=>
      other!==t.name&&refs.get(other)?.has(t.name)));
    if(!ready)throw Error('FOREIGN_KEY_REFERENCE_CYCLE');
    ordered.push(ready);remaining.delete(ready.name);
  }
  return ordered;
}
try{
  const all=(await sql("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name")).rows;
  const targets=childrenFirst(all.filter(x=>/^(soccer_|wnba_|asian_baseball_)[a-z0-9_]+$/.test(x.name)));
  for(const target of targets){
    const item={table:target.name,rowsDeleted:0,batches:0};
    result.tables.push(item);
    while(result.batches<budget){
      let rows;
      try{
        rows=(await sql('SELECT rowid AS archive_rowid,* FROM "'+target.name+
          '" ORDER BY rowid LIMIT '+limit)).rows;
        if(!rows.length)break;
        const ids=rows.map(r=>r.archive_rowid);
        if(ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)
          throw Error('INVALID_SOURCE_ROWIDS');
        if(!apply){item.eligibleSample=rows.length;break;}
        const saved=await archive(target.name,target.sql,rows);
        const outcome=await sql('DELETE FROM "'+target.name+'" WHERE rowid IN ('+ids.join(',')+')');
        if(Number(outcome.meta.changes)!==rows.length)throw Error('DELETED_COUNT_MISMATCH');
        result.rowsArchivedAndDeleted+=rows.length;result.batches++;
        item.rowsDeleted+=rows.length;item.batches++;
        item.lastArchiveKey=saved.key;item.lastSha256=saved.hash;
        await receipt();
      }catch(error){
        result.blockers.push({table:target.name,error:String(error.message||error)});
        await receipt();break;
      }
    }
    if(apply)item.remaining=(await sql('SELECT COUNT(*) n FROM "'+target.name+'"')).rows[0].n;
    if(result.batches>=budget){result.blockers.push({table:target.name,error:'BATCH_BUDGET_EXHAUSTED'});break;}
  }
  result.completed=apply&&result.blockers.length===0;
}catch(error){result.blockers.push({table:'*',error:String(error.message||error)});}
finally{
  result.finishedAt=new Date().toISOString();
  await receipt();
  console.log(JSON.stringify({completed:result.completed,deleted:result.rowsArchivedAndDeleted,
    batches:result.batches,blockers:result.blockers,progress:result.tables.filter(x=>x.rowsDeleted>0)}));
  if(result.blockers.length)process.exitCode=1;
}
