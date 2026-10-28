import {DurableObject} from 'cloudflare:workers';
import {compactPrizePicksRaw,rawSha256,ppCompactionStatement} from '../../functions/lib/prizepicksPayloadArchive.js';
export class PrizePicksHistoryMigration extends DurableObject {
 async apply(batch){
  if(this.env.MIGRATION_ENABLED!=='true')throw Error('MIGRATION_DISABLED');
  const cap=Number(this.env.MAX_ROWS);
  if(!Number.isSafeInteger(cap)||cap<1||cap>127812)throw Error('INVALID_ROW_CAP');
  if(!Array.isArray(batch?.rows)||!batch.rows.length||batch.rows.length>500)throw Error('BATCH_LIMIT');
  const digest=await rawSha256(JSON.stringify(batch));
  const initial=await this.ctx.storage.transaction(async tx=>{
   const s=await tx.get('state')||{cursor:0,processed:0,updated:0,bytesRemoved:0,busy:false};
   if(s.lastDigest===digest)return {retry:s.lastResult};
   if(s.busy||batch.afterRowid!==s.cursor||s.processed+batch.rows.length>cap)throw Error('PROGRESS_OR_ROW_LIMIT');
   s.busy=true;await tx.put('state',s);return {state:s};
  });
  if(initial.retry)return initial.retry;
  const state=initial.state;let cursor=state.cursor;const rows=[];
  for(const r of batch.rows){
   if(!Number.isSafeInteger(r.rowid)||r.rowid<=cursor||typeof r.oldRaw!=='string'||new TextEncoder().encode(r.oldRaw).length>65536)throw Error('INVALID_ROW');
   cursor=r.rowid;
   const c=await compactPrizePicksRaw(r.oldRaw,{id:r.id,driveFileId:this.env.ARCHIVE_DRIVE_FILE_ID,sourceSqlSha256:this.env.SOURCE_SQL_SHA256});
   if(c.changed)rows.push({id:r.id,oldRaw:r.oldRaw,newRaw:c.text,saved:c.bytesRemoved});
  }
  let updated=0,bytesRemoved=0;
  // Each statement has at most 100 parameters and only indexed identity lookups.
  const statements=[];for(let i=0;i<rows.length;i+=25)statements.push(ppCompactionStatement(this.env.DB,rows.slice(i,i+25)));
  if(statements.length){
   const results=await this.env.DB.batch(statements);
   for(let i=0;i<results.length;i++){
    const changed=Number(results[i]?.meta?.changes||0);const group=rows.slice(i*25,i*25+25);
    if(changed!==group.length)throw Error('SOURCE_CHANGED_MIGRATION_LOCKED');
    updated+=changed;bytesRemoved+=group.reduce((sum,r)=>sum+r.saved,0);
   }
  }
  state.cursor=cursor;state.processed+=batch.rows.length;state.updated+=updated;state.bytesRemoved+=bytesRemoved;state.busy=false;
  const result={cursor:state.cursor,processed:state.processed,updated:state.updated,bytesRemoved:state.bytesRemoved};
  state.lastDigest=digest;state.lastResult=result;await this.ctx.storage.put('state',state);return result;
 }
}
export default {async fetch(request,env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/apply')return new Response(null,{status:404});
 const a=new TextEncoder().encode(request.headers.get('x-maintenance-key')||''),b=new TextEncoder().encode(env.MAINTENANCE_KEY||'');
 if(!b.length||a.length!==b.length||!crypto.subtle.timingSafeEqual(a,b))return new Response(null,{status:403});
 const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});let n=0;const parts=[];
 try{for(;;){const {value,done}=await reader.read();if(done)break;n+=value.byteLength;if(n>4*1024*1024){await reader.cancel();return new Response(null,{status:413});}parts.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(n);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.byteLength;}
 try{return Response.json(await env.MIGRATION.getByName('pp-archive-20261028').apply(JSON.parse(new TextDecoder().decode(bytes))));}
 catch(error){return Response.json({error:String(error?.message||error)},{status:409});}
}};
