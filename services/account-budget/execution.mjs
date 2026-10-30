// Per-invocation execution limits. No counters or credentials live in module state.
const nonnegative=n=>Number.isSafeInteger(n)&&n>=0;
export function createExecutionLease(admission,{now=Date.now}={}){
 if(admission?.allowed!==true||!Number.isSafeInteger(admission.expiresAtMs)||admission.expiresAtMs<=now()||admission.expiresAtMs-now()>120000)throw Error('INVALID_EXECUTION_LEASE');
 const limits=Object.fromEntries(Object.entries(admission.maxUnits||{}));
 if(!Object.keys(limits).length||!Object.values(limits).every(nonnegative))throw Error('INVALID_EXECUTION_UNITS');
 const expiresAtMs=admission.expiresAtMs;
 const used=Object.create(null);let closed=false;
 const stop=reason=>{closed=true;throw Error(reason);};
 const live=()=>{if(closed||now()>=expiresAtMs)stop('JOB_LEASE_EXPIRED_OR_STOPPED');};
 return Object.freeze({expiresAtMs,
  live,
  stop,
  spend(cost){live();for(const [unit,amount] of Object.entries(cost))if(!nonnegative(amount)||!nonnegative(limits[unit])||!Number.isSafeInteger((used[unit]||0)+amount)||(used[unit]||0)+amount>limits[unit])stop('JOB_UNIT_LIMIT_'+unit);
   for(const [unit,amount] of Object.entries(cost))used[unit]=(used[unit]||0)+amount;
  },
  snapshot(){return {limits:{...limits},used:{...used},closed,expiresAtMs};}
 });
}
function boundedBody(body,lease,{unit="responseBytes",maxBytes=Infinity}={}){
 if(!body)return null;const reader=body.getReader();let received=0;
 return new ReadableStream({async pull(controller){try{lease.live();const part=await reader.read();lease.live();if(part.done){controller.close();reader.releaseLock();return;}received+=part.value.byteLength;if(received>maxBytes)lease.stop("RESPONSE_SIZE_MISMATCH");if(unit)lease.spend({[unit]:part.value.byteLength});controller.enqueue(part.value);}catch(error){await reader.cancel().catch(()=>{});controller.error(error);}},async cancel(reason){await reader.cancel(reason);}});
}
export function executionFetch(lease,fetchImpl,{origin,path,method:approvedMethod="GET"}={}){
 return async(input,init={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  const method=String(init.method||input?.method||'GET').toUpperCase();
  if(url.username||url.password||url.origin!==origin||url.pathname!==path||method!==approvedMethod||init.body!=null||input?.body||(init.redirect&&init.redirect!=='manual'))lease.stop('JOB_NETWORK_DESTINATION_NOT_APPROVED');
  lease.spend({requests:1});
  const timeout=AbortSignal.timeout(Math.max(1,Math.min(20000,lease.expiresAtMs-Date.now())));
  const signal=init.signal?AbortSignal.any([init.signal,timeout]):timeout;
  const response=await fetchImpl(input,{...init,method:approvedMethod,redirect:'manual',signal});
  lease.live();if(response.status===101||response.webSocket){response.webSocket?.close(1008,'Budgeted streams required');lease.stop('UNBOUNDED_STREAM_REJECTED');}
  return new Response(boundedBody(response.body,lease),{status:response.status,statusText:response.statusText,headers:response.headers});
 };
}
const bodyBytes=value=>typeof value==='string'?new TextEncoder().encode(value).length:value instanceof ArrayBuffer?value.byteLength:ArrayBuffer.isView(value)?value.byteLength:null;
export function executionR2(bucket,lease){
 const read=async(method,args)=>{
  lease.spend({r2Reads:1});const object=await bucket[method](...args);if(!object)return object;
  if(!nonnegative(object.size))lease.stop('UNKNOWN_ARCHIVE_SIZE');
  if(method==='head')return object;
  try{lease.spend({r2Bytes:object.size});}catch(error){await object.body?.cancel().catch(()=>{});throw error;}
  const body=boundedBody(object.body,lease,{unit:null,maxBytes:object.size});
  return new Proxy(object,{get(target,key){if(key==="body")return body;if(["json","text","arrayBuffer","blob"].includes(key))return()=>new Response(body)[key]();const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 };
 return Object.freeze({
  get:(...args)=>read('get',args),head:(...args)=>read('head',args),
  async put(key,body,options){const size=bodyBytes(body);if(size===null)lease.stop('UNBOUNDED_ARCHIVE_UPLOAD');lease.spend({r2Writes:1,r2Bytes:size});return bucket.put(key,body,options);},
  async list(options){if(!Number.isSafeInteger(options?.limit)||options.limit<1||options.limit>1000)lease.stop('UNBOUNDED_ARCHIVE_LIST');lease.spend({r2Lists:1});return bucket.list(options);},
  async delete(keys){const count=Array.isArray(keys)?keys.length:1;if(count<1||count>1000)lease.stop('INVALID_ARCHIVE_DELETE');lease.spend({r2Writes:count});return bucket.delete(keys);}
 });
}
// Only certified indexed point reads are currently permitted. LIMIT by itself
// never certifies a scan, join, count, sort, mutation, trigger or query plan.
const POINT_READ='SELECT id,collected_at FROM normalized_market_observations WHERE id=?';
export function executionD1(db,lease){
 const owned=new WeakMap();
 const make=(sql,args=[])=>{
  const run=async(method,extra=[])=>{
   if(sql!==POINT_READ||args.length!==1||typeof args[0]!=='string'||args[0].length>100)lease.stop('D1_QUERY_NOT_CERTIFIED');
   lease.spend({d1Queries:1,reads:2,writes:0});
   const result=await db.prepare(sql).bind(...args)[method](...extra);
   if(result?.meta&&(result.meta.rows_read>2||result.meta.rows_written>0))lease.stop('D1_CERTIFIED_BOUND_EXCEEDED');return result;
  };
  const statement=Object.freeze({bind:(...values)=>make(sql,values),all:()=>run('all'),first:(...extra)=>run('first',extra),raw:(...extra)=>run('raw',extra),run:()=>run('run')});owned.set(statement,{sql,args});return statement;
 };
 return Object.freeze({prepare:sql=>make(sql),async batch(statements){
  // Validate every member before issuing any operation, then charge as one unit.
  for(const s of statements){const p=owned.get(s);if(!p||p.sql!==POINT_READ||p.args.length!==1||typeof p.args[0]!=='string'||p.args[0].length>100)lease.stop('D1_BATCH_NOT_CERTIFIED');}
  if(!statements.length||statements.length>100)lease.stop('D1_BATCH_LIMIT');
  lease.spend({d1Queries:statements.length,reads:2*statements.length,writes:0});
  const result=await db.batch(statements.map(s=>{const p=owned.get(s);return db.prepare(p.sql).bind(...p.args);}));
  if(result.some(r=>r.meta?.rows_read>2||r.meta?.rows_written>0))lease.stop('D1_CERTIFIED_BOUND_EXCEEDED');return result;
 }});
}
export function executionEnv(env,lease,{fetchImpl=fetch,network}={}){
 const wrapped=new Map([["FBIS_JOB_FETCH",executionFetch(lease,fetchImpl,network)]]);return new Proxy(env,{get(target,key){
  if(key==='FBIS_JOB_FETCH')return wrapped.get(key);
  const value=Reflect.get(target,key);if(!value||typeof value!=='object')return value;
  if(wrapped.has(key))return wrapped.get(key);
  let replacement=value;
  if(typeof value.prepare==='function')replacement=executionD1(value,lease);
  else if(typeof value.get==='function'&&typeof value.put==='function'&&typeof value.head==='function')replacement=executionR2(value,lease);
  else if(typeof value.getByName==='function'||typeof value.idFromName==='function'||typeof value.fetch==='function')lease.stop('UNBUDGETED_SERVICE_OR_ACTOR');
  wrapped.set(key,replacement);return replacement;
 }});
}
