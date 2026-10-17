import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

for(const mode of ['success','corrupt','changed','eligible'])test('archive recovery gate: '+mode,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fbis-archive-test-'));
 try{
 const sql=await readFile(new URL('../migrations/0095_normalized_market_observation_ledger.sql',import.meta.url),'utf8');
 const schema=sql.match(/CREATE TABLE IF NOT EXISTS normalized_market_observations \([\s\S]*?\n\);/)[0];
 const columns=schema.split('\n').slice(1,-1).map(s=>s.trim().split(' ')[0]);
 const row=Object.fromEntries(columns.map(c=>[c,null]));
 Object.assign(row,{id:"id'1",observation_key:'key1',source:'fixture',source_type:'test',sport:'nfl',market_family:'spread',collected_at:'2026-01-01',created_at:'2026-01-01',snapshot_type:'RESEARCH',decision_eligible:0,can_qualify:0,can_authorize_wager:0,line:1.125,raw_payload_json:'{"unicode":"é","null":null}'});
 if(mode==='eligible')row.can_qualify=1;
 const sourceRow={__source_rowid:'1052',...row};
 const mock=`const schema=${JSON.stringify(schema)},cols=${JSON.stringify(columns)},row=${JSON.stringify(sourceRow)},mode=${JSON.stringify(mode)};const objects=new Map();
 globalThis.fetch=async(url,options={})=>{if(url.includes('/r2/')){if(options.method==='PUT'){objects.set(url,Buffer.from(options.body));return new Response('{}');}const b=objects.get(url);return b?new Response(mode==='corrupt'?Buffer.from('bad'):b):new Response('',{status:404});}
 if(!options.body)return Response.json({success:true,result:{file_size:1000}});
 const {sql}=JSON.parse(options.body);if(!/^(SELECT|PRAGMA)/.test(sql))throw Error('WRITE_ATTEMPT');let results;
 if(sql.includes('sqlite_master'))results=[{sql:schema}];else if(sql.startsWith('PRAGMA'))results=cols.map(name=>({name}));else if(sql.includes('MAX(rowid)'))results=[{upper:1052}];else if(sql.includes('id IN'))results=[{...row,...(mode==='changed'?{line:2}:{})}];else results=[row];
 return Response.json({success:true,result:[{success:true,results,meta:{changed_db:false,rows_written:0,size_after:1000}}]});};`;
 const mockPath=join(dir,'mock.mjs');await writeFile(mockPath,mock);
 const run=spawnSync(process.execPath,['--import',mockPath,new URL('../scripts/storage-research-archive.mjs',import.meta.url).pathname],{encoding:'utf8',env:{...process.env,CLOUDFLARE_API_TOKEN:'fixture',CLOUDFLARE_ACCOUNT_ID:'fixture',ARCHIVE_MAX_ROWS:'1',ARCHIVE_OUTPUT:join(dir,'out')}});
 const result=JSON.parse(await readFile(join(dir,'out/result.json'),'utf8'));
 assert.equal(result.sourceDbMutations,0);assert.equal(result.sourceRowsDeleted,0);assert.equal(result.retentionReleaseAuthorized,false);
 if(mode==='success'){assert.equal(run.status,0,run.stderr);assert.equal(result.restoration.fullFieldParity,true);assert.equal(result.archive.rows,1);assert.equal(result.archive.columns,50);assert.equal(result.archive.r2DownloadVerified,true);}
 else{assert.notEqual(run.status,0);assert.equal(result.completed,false);assert.match(result.error,mode==='corrupt'?/R2_READBACK/:mode==='changed'?/SOURCE_CHANGED/:/INELIGIBLE/);}
 }finally{await rm(dir,{recursive:true,force:true});}
});
