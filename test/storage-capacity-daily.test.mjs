import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
for(const bytes of [6900000000,7000000000,8000000000,8500000000,9000000000,9500000000,10007482368])test('daily physical capacity '+bytes,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'capacity-test-'));
 try{
 const mock=`const objects=new Map();globalThis.fetch=async(url,o={})=>{if(url.includes('/r2/')){if(o.method==='PUT'){objects.set(url,o.body);return new Response('{}');}const b=objects.get(url);return b?new Response(b):new Response('',{status:404});}if(o.method&&o.method!=='GET')throw Error('D1_MUTATION_ATTEMPT');return Response.json({success:true,result:{name:'fixture',file_size:${bytes}}});};`;
 await writeFile(join(dir,'mock.mjs'),mock);
 const r=spawnSync(process.execPath,['--import',join(dir,'mock.mjs'),new URL('../scripts/storage-capacity-daily.mjs',import.meta.url).pathname],{encoding:'utf8',env:{...process.env,CLOUDFLARE_API_TOKEN:'fixture',CLOUDFLARE_ACCOUNT_ID:'fixture',CAPACITY_OUTPUT:join(dir,'out')}});
 const report=JSON.parse(await readFile(join(dir,'out/result.json'),'utf8'));
 assert.equal(report.sourceDbMutations,0);assert.equal(report.retentionReleaseAuthorized,false);
 assert.equal(report.databases[0].physicalBytes,bytes);assert.equal(r.status,bytes>=9000000000?1:0,r.stderr);
 assert.equal(report.primaryThresholdPercent,bytes>=10000000000?100:bytes>=9500000000?95:bytes>=9000000000?90:bytes>=8500000000?85:bytes>=8000000000?80:bytes>=7000000000?70:0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
