/** Idempotent archive ingestion only. This helper cannot invoke paid capture routes. */
export async function ingestPinnArchiveStep({base,secret,body,fetchImpl=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=5}){
 if(!['prepare','consume','reconcile'].includes(body?.operation))throw Error('ARCHIVE_INGEST_OPERATION_ONLY');
 let last;
 for(let attempt=0;attempt<attempts;attempt++){
  try{
   const r=await fetchImpl(base+'/api/pinnodds-ingest',{method:'POST',headers:{'content-type':'application/json','x-harvest-secret':secret},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
   let result;try{result=await r.json()}catch{throw Error(`TRANSIENT_${r.status}`)}
   if(r.ok&&result.ok)return result;
   const error=Error(`${r.status}:${result.error||'INGEST_FAILED'}`);
   if(r.status<500&&r.status!==429){error.permanent=true;throw error;}
   throw error;
  }catch(e){last=e;if(e.permanent||attempt+1===attempts)throw e;await wait(1000*2**attempt);}
 }
 throw last;
}
