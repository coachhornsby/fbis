// Persistent single-writer primitive. No timers, expiry-based unlocks, or recovery bypass.
// The host must supply transactional storage from one durable coordinator per account.
const ACTIVE='archive:v1:active',COUNT='archive:v1:count',PREFIX='archive:v1:operation:';
export const MAX_ARCHIVE_OPERATIONS=10000;
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const validTime=value=>Number.isSafeInteger(value)&&value>=0;
const fail=code=>{throw Error(code);};
function receipt(result){
 if(result?.independentRestoreVerified!==true||typeof result.manifestId!=='string'||!result.manifestId||result.manifestId.length>160||!validHash(result.manifestSha256))fail('ARCHIVE_VERIFIED_RECEIPT_REQUIRED');
 return{manifestId:result.manifestId,manifestSha256:result.manifestSha256};
}

export async function serializeArchive(storage,{operationId,intentSha256},run,{now=Date.now}={}){
 if(!storage?.transaction||!validId(operationId)||!validHash(intentSha256)||typeof run!=='function')fail('ARCHIVE_SERIALIZATION_INPUT');
 const startedAt=now();if(!validTime(startedAt))fail('ARCHIVE_CLOCK_INVALID');
 // Reject replay even after completion. Active lock is account-wide, not keyed
 // by a mutable batch label or folder that another caller could use to evade it.
 const claim=await storage.transaction(async txn=>{
  if(await txn.get(PREFIX+operationId))return{allowed:false,reason:'ARCHIVE_OPERATION_REPLAY'};
  if(await txn.get(ACTIVE))return{allowed:false,reason:'ARCHIVE_WRITER_BUSY_OR_UNCERTAIN'};
  const storedCount=await txn.get(COUNT),count=storedCount===undefined?0:storedCount;
  if(!Number.isSafeInteger(count)||count<0||count>=MAX_ARCHIVE_OPERATIONS)return{allowed:false,reason:'ARCHIVE_OPERATION_LEDGER_FULL_OR_INVALID'};
  const record={operationId,intentSha256,phase:'running',startedAt};
  await txn.put(PREFIX+operationId,record);await txn.put(ACTIVE,record);await txn.put(COUNT,count+1);
  return{allowed:true};
 });
 if(!claim.allowed)fail(claim.reason);
 let result;
 try{
  // External work is intentionally outside the storage transaction, with the
  // durable claim committed first. Transaction retries cannot repeat IO.
  result=await run();const verified=receipt(result);const completedAt=now();
  if(!validTime(completedAt)||completedAt<startedAt)fail('ARCHIVE_CLOCK_INVALID');
  await storage.transaction(async txn=>{
   const active=await txn.get(ACTIVE),operation=await txn.get(PREFIX+operationId);
   if(active?.operationId!==operationId||active.intentSha256!==intentSha256||active.phase!=='running'||operation?.phase!=='running'||operation.intentSha256!==intentSha256)fail('ARCHIVE_LOCK_OWNERSHIP_LOST');
   await txn.put(PREFIX+operationId,{...operation,phase:'completed',completedAt,...verified});
   // Null is a logical lock release, not deletion of the audit ledger or data.
   await txn.put(ACTIVE,null);
  });
 }catch{
  // Even an apparently early failure may follow an uncertain side effect. Never
  // expire/release it automatically. A failed state write still leaves running
  // lock persisted from acquisition, blocking every other operation.
  try{await storage.transaction(async txn=>{
   const active=await txn.get(ACTIVE),operation=await txn.get(PREFIX+operationId);
   if(active?.operationId===operationId&&active.intentSha256===intentSha256&&operation?.phase==='running'){
    const uncertain={...operation,phase:'uncertain'};await txn.put(PREFIX+operationId,uncertain);await txn.put(ACTIVE,uncertain);
   }
  });}catch{/* Original durable running claim remains; no unlock is attempted. */}
  fail('ARCHIVE_OPERATION_UNCERTAIN_RECONCILIATION_REQUIRED');
 }
 return result;
}

export async function inspectArchiveOperation(storage,operationId){
 if(!storage?.transaction||!validId(operationId))fail('ARCHIVE_SERIALIZATION_INPUT');
 // Read-only inspection cannot release or replace an active/uncertain writer.
 return storage.transaction(async txn=>({active:await txn.get(ACTIVE)||null,operation:await txn.get(PREFIX+operationId)||null}));
}
