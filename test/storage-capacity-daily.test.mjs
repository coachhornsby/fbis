import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DATABASE_OWNERS} from '../functions/lib/databaseOwnership.js';

function expectedThreshold(bytes){
  if(bytes>=10000000000)return 100;
  if(bytes>=9000000000)return 90;
  if(bytes>=8500000000)return 85;
  if(bytes>=8000000000)return 80;
  if(bytes>=7000000000)return 70;
  return 0;
}

for(const bytes of [6900000000,7000000000,8000000000,8500000000,9000000000,9500000000,10007482368])test('daily physical capacity '+bytes,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'capacity-test-'));
 try{
 const mock=`const objects=new Map();globalThis.fetch=async(url,o={})=>{if(url.includes('/r2/')){if(o.method==='PUT'){objects.set(url,o.body);return new Response('{}');}const b=objects.get(url);return b?new Response(b):new Response('',{status:404});}if(o.method&&o.method!=='GET')throw Error('D1_MUTATION_ATTEMPT');return Response.json({success:true,result:{name:'fixture',file_size:${bytes}}});};`;
 await writeFile(join(dir,'mock.mjs'),mock);
 const r=spawnSync(process.execPath,['--import',join(dir,'mock.mjs'),new URL('../scripts/storage-capacity-daily.mjs',import.meta.url).pathname],{encoding:'utf8',env:{...process.env,CLOUDFLARE_API_TOKEN:'fixture',CLOUDFLARE_ACCOUNT_ID:'fixture',CAPACITY_OUTPUT:join(dir,'out')}});
 const report=JSON.parse(await readFile(join(dir,'out/result.json'),'utf8'));
 assert.equal(report.sourceDbMutations,0);assert.equal(report.retentionReleaseAuthorized,false);
 assert.equal(report.retentionRequiresVerifiedRecovery,true);
 assert.equal(report.operationsDbPreferred,true);
 assert.equal(report.databases.length,Object.keys(DATABASE_OWNERS).length);
 assert.ok(report.databases.some(d=>d.key==='MARKET_HISTORY_2026Q4'));
 for(const sport of ['CFB','CBB','NFL','NBA','WNBA','MLB','NHL','SOCCER','TENNIS','NPB','KBO'])assert.ok(report.databases.some(d=>d.key===sport),sport);
 assert.equal(report.databases[0].key,'PRIMARY');
 assert.ok(report.databases.some(d=>d.key==='OPERATIONS'));
 assert.ok(report.databases.some(d=>d.key==='COLD_HISTORY'));
 assert.equal(report.databases[0].physicalBytes,bytes);assert.equal(r.status,bytes>=9500000000?1:0,r.stderr);
 assert.equal(report.primaryThresholdPercent,expectedThreshold(bytes));
 assert.ok(Array.isArray(report.alertsTriggered.warn75));
 assert.ok(Array.isArray(report.alertsTriggered.degraded85));
 assert.ok(Array.isArray(report.alertsTriggered.critical95));
 assert.equal(report.platformThresholdPercent,bytes>=10000000000?100:bytes>=9500000000?95:bytes>=8500000000?85:bytes>=7500000000?75:0);
 assert.ok(Array.isArray(report.alertsTriggered.watch80));
 assert.ok(Array.isArray(report.alertsTriggered.high85));
 assert.ok(Array.isArray(report.alertsTriggered.critical90));
 }finally{await rm(dir,{recursive:true,force:true});}
});
