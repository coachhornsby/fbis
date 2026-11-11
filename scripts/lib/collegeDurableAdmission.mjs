// Optional GitHub-runner transport. Inactive until explicitly wired by its owner.
// Uses existing D1 governor unchanged; never expands daily/monthly/dedup caps.
import {reserveCfbdRequest,completeCfbdRequest} from '../../functions/lib/cfbCfbdAcquisition.js';
export function createCollegeDurableAdmission({accountId,databaseId,token,cloudflareFetch=fetch,providerFetch=fetch,now=Date.now,maxCalls=2,deploymentLimits,admitD1Query}={}){
 if(!/^[a-f0-9]{32}$/.test(accountId||'')||!/^[a-f0-9-]{36}$/.test(databaseId||'')||!token||maxCalls!==2)throw Error('COLLEGE_ADMISSION_CONFIG_INVALID');
 if(typeof admitD1Query!=='function')throw Error('COLLEGE_ACCOUNT_D1_ADMISSION_REQUIRED');
 const caps={CFBD_DAILY_NETWORK_BUDGET:45,CFBD_MONTHLY_NETWORK_BUDGET:1400,CFBD_SHARED_PROVIDER_SAFE_BUDGET:67500};
 if(!deploymentLimits||Object.keys(deploymentLimits).sort().join('|')!==Object.keys(caps).sort().join('|')||Object.entries(caps).some(([k,max])=>!Number.isSafeInteger(deploymentLimits[k])||deploymentLimits[k]<1||deploymentLimits[k]>max))throw Error('COLLEGE_VERIFIED_DEPLOYMENT_LIMITS_REQUIRED');
 const stats={providerAttempts:0,d1AdmissionAttempts:0,d1Requests:0,rowsRead:0,rowsWritten:0};let poisoned=false;
 async function query(sql,params=[]){
  stats.d1AdmissionAttempts++;
  try{
   const permit=await admitD1Query({accountId,databaseId,sql,params:[...params]});
   if(permit?.allowed!==true||permit.queryPlanVerified!==true||![permit.maxRowsRead,permit.maxRowsWritten,permit.expiresAtMs].every(Number.isSafeInteger)||permit.maxRowsRead<0||permit.maxRowsWritten<0||permit.expiresAtMs<=Number(typeof now==='function'?now():now))throw Error('D1_ACCOUNT_ADMISSION_DENIED');
   stats.d1Requests++;
   const r=await cloudflareFetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('D1_HTTP');const payload=await r.json();const item=payload.result?.[0];
   if(payload.success!==true||item?.success!==true)throw Error('D1_RESULT');
   if((sql.startsWith('UPDATE ')||sql.startsWith('INSERT INTO api_usage'))&&Number(item.meta?.changes)!==1)throw Error('D1_WRITE_NOT_CONFIRMED');
   const reads=item.meta?.rows_read,writes=item.meta?.rows_written;
   if(!Number.isSafeInteger(reads)||reads<0||!Number.isSafeInteger(writes)||writes<0)throw Error('D1_USAGE_UNVERIFIED');
   stats.rowsRead+=reads;stats.rowsWritten+=writes;
   if(reads>permit.maxRowsRead||writes>permit.maxRowsWritten)throw Error('D1_CERTIFIED_BOUND_EXCEEDED');
   return item;
  }catch{poisoned=true;throw Error('COLLEGE_DURABLE_ACCOUNTING_UNAVAILABLE');}
 }
 const DB={prepare(sql){let params=[];return{bind(...values){params=values;return this;},run(){return query(sql,params);},async first(){return(await query(sql,params)).results?.[0]??null;}};}};
 const env={DB,...deploymentLimits,cfbdNetworkAuthorized:true,cbbdNetworkAuthorized:true};
 async function admittedFetch(url,options={}){
  if(poisoned)throw Error('COLLEGE_ADMISSION_HALTED');
  const u=new URL(url);
  if(u.protocol!=='https:'||!['api.collegefootballdata.com','api.collegebasketballdata.com'].includes(u.hostname)||u.port||u.username||u.password||(options.method||'GET')!=='GET')throw Error('COLLEGE_REQUEST_NOT_ALLOWED');
  if(stats.providerAttempts>=maxCalls)throw Error('COLLEGE_TWO_CALL_CAP');
  const timestamp=Number(typeof now==='function'?now():now);
  if(!Number.isSafeInteger(timestamp)||timestamp<0)throw Error('COLLEGE_CLOCK_INVALID');
  const month=new Date(timestamp).toISOString().slice(0,7);
  // A stale local estimate cannot admit new spending. This does not probe the provider.
  const health=await DB.prepare(`SELECT c.last_remaining,c.blocked_until_ms,
   (SELECT MAX(acquired_at) FROM cfb_cfbd_acquisition_receipts WHERE provider_remaining IS NOT NULL AND request_month=?) balance_at,
   (SELECT EXISTS(SELECT 1 FROM cfb_cfbd_acquisition_receipts WHERE request_month=? AND request_status='reserved' LIMIT 1)) unresolved
   FROM cfb_cfbd_acquisition_control c WHERE c.id=1`).bind(month,month).first();
  const age=timestamp-Date.parse(health?.balance_at);
  if(!health||!Number.isFinite(age)||age<0||age>6*3600000||!Number.isSafeInteger(health.last_remaining)||health.last_remaining<=100||!Number.isSafeInteger(health.blocked_until_ms)||health.blocked_until_ms<0||health.blocked_until_ms>timestamp||health.unresolved!==0)throw Error('COLLEGE_QUOTA_ACCOUNT_UNRESOLVED');
  const permit=await reserveCfbdRequest(env,url,timestamp);
  if(!permit.allowed)throw Error(permit.reason);
  // Charge before outbound IO: crash/transport failure cannot undercount usage.
  const source=u.hostname.includes('basketball')?'cbbd':'cfbd';
  const charge=await query(`INSERT INTO api_usage (source,endpoint,month,captured_at,cache_hit,http_status,records_returned,quota_cost,ok,reason,query_keys,elapsed_ms) VALUES (?,?,?,?,0,0,0,1,0,'durable-reserved',?,0)`,[source,u.pathname,month,new Date(timestamp).toISOString(),[...u.searchParams.keys()].sort().join(',')]);
  const usageId=charge.meta?.last_row_id;if(!Number.isInteger(usageId)||usageId<=0){poisoned=true;throw Error('COLLEGE_USAGE_RECEIPT_UNVERIFIED');}
  let response,status=0,error=false;stats.providerAttempts++;
  try{response=await providerFetch(url,{...options,redirect:'manual'});status=response.status;}catch{error=true;}
  await completeCfbdRequest(env,permit,status,response,timestamp);
  if(poisoned)throw Error('COLLEGE_DURABLE_ACCOUNTING_UNAVAILABLE');
  await query('UPDATE api_usage SET http_status=?,ok=?,reason=? WHERE rowid=?',[status,status>=200&&status<300?1:0,error?'transport-error':status===429?'rate-limited':'durable-complete',usageId]);
  if(error)throw Error('COLLEGE_PROVIDER_TRANSPORT_ERROR');
  return response;
 }
 let queue=Promise.resolve();
 const fetchFn=(url,options)=>{const task=queue.then(()=>admittedFetch(url,options));queue=task.catch(()=>{});return task;};
 return{fetchFn,stats};
}
