import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../services/account-budget/package.json',import.meta.url));
const {Miniflare}=require(process.env.FBIS_MINIFLARE_MODULE||'miniflare');
const root=new URL('../services/archive/',import.meta.url);
const moduleCode=await readFile(new URL('archiveSerialization.mjs',root),'utf8');
function runtime(path){return new Miniflare({compatibilityDate:'2026-07-01',durableObjectsPersist:path,
 modules:[{type:'ESModule',path:new URL('offline-serialization-test.mjs',root).pathname,contents:`
 import {DurableObject} from 'cloudflare:workers';
 import {serializeArchive,inspectArchiveOperation} from './archiveSerialization.mjs';
 export class OfflineArchive extends DurableObject {
  async run(input){try{return await serializeArchive(this.ctx.storage,{operationId:input.id,intentSha256:'a'.repeat(64)},async()=>{
   if(input.crash)throw Error('simulated lost response');
   await new Promise(resolve=>setTimeout(resolve,100));
   return{independentRestoreVerified:true,manifestId:'fixture',manifestSha256:'b'.repeat(64)};
  });}catch(error){return{error:error.message};}}
  async inspect(id){return inspectArchiveOperation(this.ctx.storage,id);}
 }
 export default {async fetch(request,env){const input=await request.json(),actor=env.ARCHIVE.getByName('one-account');return Response.json(input.inspect?await actor.inspect(input.id):await actor.run(input));}};
 `},{type:'ESModule',path:new URL('archiveSerialization.mjs',root).pathname,contents:moduleCode}],
 durableObjects:{ARCHIVE:{className:'OfflineArchive',useSQLite:true}}});}
async function call(mf,input){return(await mf.dispatchFetch('http://offline.test',{method:'POST',body:JSON.stringify(input)})).json();}
test('SQLite-backed lock serializes parallel calls and preserves replay/uncertainty across restart',async()=>{
 const path=await mkdtemp(join(tmpdir(),'fbis-archive-serialization-'));let mf;
 try{
  mf=runtime(path);const results=await Promise.all(Array.from({length:20},(_,i)=>call(mf,{id:'run'+i})));
  const successes=results.map((r,i)=>({r,i})).filter(x=>!x.r.error);assert.equal(successes.length,1);
  const completedId='run'+successes[0].i;
  assert.equal((await call(mf,{id:completedId,inspect:true})).operation.phase,'completed');
  await mf.dispose();mf=runtime(path);assert.equal((await call(mf,{id:completedId})).error,'ARCHIVE_OPERATION_REPLAY');
  assert.equal((await call(mf,{id:'uncertain',crash:true})).error,'ARCHIVE_OPERATION_UNCERTAIN_RECONCILIATION_REQUIRED');
  await mf.dispose();mf=runtime(path);assert.equal((await call(mf,{id:'after-restart'})).error,'ARCHIVE_WRITER_BUSY_OR_UNCERTAIN');
  assert.equal((await call(mf,{id:'uncertain',inspect:true})).active.phase,'uncertain');
 }finally{if(mf)await mf.dispose();await rm(path,{recursive:true,force:true});}
});
