/** Retry transient D1 import contention; never retry a schema/parity/authority denial. */
export async function retryCbbMigration(operation,{attempts=20,delayMs=30000,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onRetry=()=>{}}={}){
 for(let attempt=1;attempt<=attempts;attempt++){
  try {const r=await operation();if(r?.ok===false)throw Error(JSON.stringify(r));return r;}
  catch(error){const message=String(error?.message||error);
   if(attempt===attempts||!/long-running import|database is locked|SQLITE_BUSY|HTTP (502|503|504)|fetch failed|timed? ?out/i.test(message))throw error;
   await onRetry({attempt,error:message,delayMs});await sleep(delayMs);
  }
 }
}
