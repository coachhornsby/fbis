/** Controlled one-shot migration. No provider capture, archive uploads or deletes. */
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const BASE='https://fbis-myz.pages.dev';
const secret=process.env.HARVEST_SECRET;
if(!secret)throw Error('HARVEST_SECRET required');
const cutoff=process.env.COMPACTION_CUTOFF||new Date().toISOString();
const maxRows=Number(process.env.COMPACTION_MAX_ROWS||500000);
if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>1000000||!Number.isFinite(Date.parse(cutoff)))throw Error('Invalid migration bounds');
const apply=process.env.COMPACTION_APPLY==='true';
const start=Number(process.env.COMPACTION_START||0),end=Number(process.env.COMPACTION_END||Number.MAX_SAFE_INTEGER);
if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start)throw Error('Invalid shard bounds');
async function call(body){
 for(let attempt=0;attempt<6;attempt++){
  try{const r=await fetch(BASE+'/api/polymarket-storage',{method:'POST',headers:{'content-type':'application/json','x-harvest-secret':secret},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
   if(!r.ok){const e=await r.json().catch(()=>({}));throw Error('maintenance-http-'+r.status+': '+String(e.error||'unknown').slice(0,300));}
   const value=await r.json();if(!value.ok)throw Error(value.error||'maintenance-error');return value;
  }catch(e){if(attempt===5)throw e;await new Promise(r=>setTimeout(r,Math.min(15000,1000*2**attempt)));}
 }
}
const result={cutoff,apply,examined:0,eligible:0,updated:0,bytesRemoved:0,potentialBytesSaved:0,restoreChecks:0,reasons:{},completed:false};
let cursor=start,batches=0;result.startRowid=start;result.endRowid=end;
let failure=null;
try{
while(result.examined<maxRows){
 const value=await call({operation:'compact',apply,cutoff,afterRowid:cursor,limit:Math.min(250,maxRows-result.examined)});
 result.examined+=value.examined;result.eligible+=value.eligible;result.updated+=value.updated;result.bytesRemoved+=value.bytesRemoved;result.potentialBytesSaved+=value.potentialPayloadBytesSaved;
 for(const [key,n] of Object.entries(value.reasons||{}))result.reasons[key]=(result.reasons[key]||0)+n;
 if(apply&&value.verificationSamples?.length&&(result.restoreChecks===0||batches%25===0||value.nextCursor===null)){
  const proof=value.verificationSamples[0],restored=await call({operation:'restore',observationId:proof.id});
  const hash=createHash('sha256').update(JSON.stringify(restored.raw)).digest('hex');
  if(hash!==proof.originalHash)throw Error('RESTORED_SOURCE_HASH_MISMATCH');result.restoreChecks++;
 }
 batches++;result.batches=batches;result.nextCursor=value.nextCursor;
 await writeFile('/tmp/fbis-polymarket-storage-result.json',JSON.stringify(result,null,2));
 if(batches%25===0)console.log(JSON.stringify({...result,batches,nextCursor:value.nextCursor}));
 if(value.nextCursor===null||value.nextCursor>=end){result.completed=true;break;}
 if(value.nextCursor<=cursor)throw Error('COMPACTION_CURSOR_DID_NOT_ADVANCE');cursor=value.nextCursor;
}
if(!result.completed)throw Error('Compaction row budget exhausted; scope is incomplete');
}catch(error){failure=error;result.error=String(error?.message||error);}
result.nextCursor=result.completed?null:cursor;result.batches=batches;
console.log(JSON.stringify(result));
await writeFile('/tmp/fbis-polymarket-storage-result.json',JSON.stringify(result,null,2));
if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,`# Polymarket storage migration\n\n${JSON.stringify(result,null,2)}\n`,{flag:'a'});
if(failure)throw failure;
