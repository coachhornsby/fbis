#!/usr/bin/env node
/** Retired-sport source/research scrub. Exact scoped hot rows only.
 * Every delete requires whole-row R2 SHA-256 readback and source parity.
 * Final scores, bets, economic grades and immutable decisions stay protected.
 */
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const db='b50c724c-903b-4241-8ce1-48d931e7a44c';
const name='PRIMARY';
const allowed=[
 'daily_metrics','team_form','team_form_games','daily_reports',
 'job_runs','harvest_retry_queue','pipeline_stage_runs',
 'shadow_market_observations','shadow_collection_runs','shadow_cost_ledger',
 'shadow_provider_reliability','shadow_promotion_metrics','shadow_dead_letters',
 'canonical_provider_health','canonical_misprice_snapshots',
 'action_market_book_observations','action_market_snapshot_pointers',
 'canonical_dq_findings','action_event_identity_links',
 'player_availability_observations','prizepicks_prop_lines',
 'prizepicks_prop_observations','player_prop_cards','player_prop_legs',
 'source_observations','team_feature_snapshots','fbis_state_observations',
 'learning_monitor_runs','recalibration_runs','challenger_evaluations',
 'online_learning_shadow','bayesian_learning_state'
];
const where="sport IN ('soccer','wnba','npb','kbo')";
const batch=100,limit=Math.min(3000,Number(process.env.RETIRED_MAX_BATCHES||2500));
if(!account||!token||!Number.isSafeInteger(limit)||limit<1)throw Error('INVALID_CREDENTIALS_OR_LIMIT');
const url='https://api.cloudflare.com/client/v4/accounts/'+account;
const hash=s=>createHash('sha256').update(s).digest('hex');
const outfile='/tmp/fbis-retired-shared-source/scrub-result.json';
const output={contract:'fbis-retired-shared-source-scrub-v1',startedAt:new Date().toISOString(),db:name,
 protected:['nfl','mlb','nba','nhl','cfb','cbb','tennis'],target:['soccer','wnba','npb','kbo'],
 sourceRowsDeleted:0,r2RowsReadback:0,tables:[],blockers:[],completed:false};
await mkdir('/tmp/fbis-retired-shared-source',{recursive:true});
async function api(path,init={}){
 const r=await fetch(url+path,{...init,headers:{authorization:'Bearer '+token,...(init.headers||{})},signal:AbortSignal.timeout(160000)});
 if(!r.ok)throw Error('CF_HTTP_'+r.status+'_'+(await r.text()).slice(0,400));
 return r;
}
async function sql(statement){
 const v=await(await api('/d1/database/'+db+'/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql:statement})})).json();
 if(!v.success||v.result?.[0]?.success!==true)throw Error('D1_ERROR_'+JSON.stringify(v.errors));
 return v.result[0];
}
async function save(){await writeFile(outfile,JSON.stringify(output,null,2)+'\n');}
const tableNames=allowed.map(x=>"'"+x+"'").join(',');
const schema=(await sql("SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ("+tableNames+")")).results;
const map=new Map(schema.map(t=>[t.name,t]));
const references=new Map(schema.map(t=>[t.name,new Set([...t.sql.matchAll(/REFERENCES\s+["']?([a-z_][a-z0-9_]*)/gi)].map(m=>m[1]))]));
const ordered=[];
const remaining=new Set(schema.map(x=>x.name));
while(remaining.size){
 const next=[...remaining].find(n=>![...remaining].some(child=>child!==n&&references.get(child)?.has(n)));
 if(!next)throw Error('RETIRED_SCHEMA_FOREIGN_KEY_CYCLE');
 ordered.push(next);remaining.delete(next);
}
let batches=0;
try{
 for(const table of ordered){
  const rec={table,deleted:0,archived:0,blocked:null};
  output.tables.push(rec);
  const cols=(await sql('PRAGMA table_info('+table+')')).results;
  if(!cols.some(c=>c.name==='sport')){rec.skipped='NO_SPORT_COLUMN';continue;}
  const schemaText=map.get(table)?.sql;
  if(!schemaText)throw Error('TABLE_SCHEMA_MISSING');
  while(batches<limit){
   let rows;
   try{
    rows=(await sql('SELECT rowid AS source_rowid,* FROM '+table+' WHERE '+where+' ORDER BY rowid LIMIT '+batch)).results;
    if(!rows.length)break;
    if(rows.some(x=>!['soccer','wnba','npb','kbo'].includes(x.sport)))throw Error('SPORT_SCOPE_VIOLATED');
    const ids=rows.map(x=>x.source_rowid);
    if(ids.some(x=>!Number.isSafeInteger(x)||x<1))throw Error('INVALID_ROWID');
    const body=JSON.stringify({contract:'fbis-retired-sport-row-archive-v1',source_database:db,table,schema:schemaText,rows,source_rows_deleted_before_archive:0});
    const digest=hash(body),key='retired-sports/2026-10-26/PRIMARY/'+table+'/sha256-'+digest+'.json';
    const path='/r2/buckets/fbis-archive/objects/'+key;
    await api(path,{method:'PUT',headers:{'content-type':'application/json'},body});
    const copy=await(await api(path)).text();
    if(hash(copy)!==digest)throw Error('ARCHIVE_READBACK_FAILED');
    const source=(await sql('SELECT rowid AS source_rowid,* FROM '+table+' WHERE rowid IN ('+ids.join(',')+') ORDER BY rowid')).results;
    if(hash(JSON.stringify(rows))!==hash(JSON.stringify(source)))throw Error('SOURCE_CHANGED_BEFORE_DELETE');
    const del=await sql('DELETE FROM '+table+' WHERE '+where+' AND rowid IN ('+ids.join(',')+')');
    if(Number(del.meta.changes)!==rows.length)throw Error('DELETE_ROW_COUNT_MISMATCH');
    rec.deleted+=rows.length;rec.archived+=rows.length;rec.lastArchiveSha256=digest;
    output.sourceRowsDeleted+=rows.length;output.r2RowsReadback+=rows.length;
    batches++;
    if(batches%10===0)await save();
   }catch(e){rec.blocked=String(e.message||e);output.blockers.push({table,error:rec.blocked});break;}
  }
  rec.remaining=(await sql('SELECT COUNT(*) AS n FROM '+table+' WHERE '+where)).results[0].n;
  if(batches>=limit){output.blockers.push({table,error:'BATCH_BUDGET_EXHAUSTED'});break;}
 }
 output.completed=!output.blockers.length;
}catch(e){output.blockers.push({table:'*',error:String(e.message||e)});}
finally{
 output.batches=batches;output.finishedAt=new Date().toISOString();
 await save();
 console.log(JSON.stringify({deleted:output.sourceRowsDeleted,batches,completed:output.completed,
  blockers:output.blockers,tables:output.tables.filter(t=>t.deleted)}));
 if(output.blockers.length)process.exitCode=1;
}
