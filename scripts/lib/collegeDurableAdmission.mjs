// Optional GitHub-runner transport. Inactive until explicitly wired by its owner.
// Uses existing D1 governor unchanged; never expands daily/monthly/dedup caps.
import {reserveCfbdRequest,completeCfbdRequest} from '../../functions/lib/cfbCfbdAcquisition.js';
export function createCollegeDurableAdmission({accountId,databaseId,token,cloudflareFetch=fetch,providerFetch=fetch,now=Date.now,maxCalls=2}={}){
 if(!/^[a-f0-9]{32}$/.test(accountId||'')||!/^[a-f0-9-]{36}$/.test(databaseId||'')||!token||maxCalls!==2)throw Error('COLLEGE_ADMISSION_CONFIG_INVALID');
 const stats={providerAttempts:0,d1Requests:0,rowsRead:0,rowsWritten:0};let poisoned=false;
 async function query(sql,params=[]){
  stats.d1Requests++;
  try{
   const r=await cloudflareFetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('D1_HTTP');const payload=await r.json();const item=payload.result?.[0];
   if(payload.success!==true||item?.success!==true)throw Error('D1_RESULT');
   if((sql.startsWith('UPDATE ')||sql.startsWith('INSERT INTO api_usage'))&&Number(item.meta?.changes)!==1)throw Error('D1_WRITE_NOT_CONFIRMED');
   stats.rowsRead+=Number(item.meta?.rows_read||0);stats.rowsWritten+=Number(item.meta?.rows_written||0);return item;
  }catch{poisoned=true;throw Error('COLLEGE_DURABLE_ACCOUNTING_UNAVAILABLE');}
 }
 const DB={prepare(sql){let params=[];return{bind(...values){params=values;return this;},run(){return query(sql,params);},async first(){return(await query(sql,params)).results?.[0]??null;}};}};
 const env={DB,cfbdNetworkAuthorized:true,cbbdNetworkAuthorized:true};
 async function admittedFetch(url,options={}){
  if(poisoned)throw Error('COLLEGE_ADMISSION_HALTED');
  const u=new URL(url);
  if(u.protocol!=='https:'||!['api.collegefootballdata.com','api.collegebasketballdata.com'].includes(u.hostname)||u.port||u.username||u.password||(options.method||'GET')!=='GET')throw Error('COLLEGE_REQUEST_NOT_ALLOWED');
  if(stats.providerAttempts>=maxCalls)throw Error('COLLEGE_TWO_CALL_CAP');
  const timestamp=Number(typeof now==='function'?now():now),month=new Date(timestamp).toISOString().slice(0,7);
  // A stale local estimate cannot admit new spending. This does not probe the provider.
  const health=await DB.prepare(`SELECT c.last_remaining,c.blocked_until_ms,
   (SELECT MAX(acquired_at) FROM cfb_cfbd_acquisition_receipts WHERE provider_remaining IS NOT NULL AND request_month=?) balance_at,
   (SELECT COUNT(*) FROM cfb_cfbd_acquisition_receipts WHERE request_status='reserved') unresolved
   FROM cfb_cfbd_acquisition_control c WHERE c.id=1`).bind(month).first();
  const age=timestamp-Date.parse(health?.balance_at);
  if(!health||!Number.isFinite(age)||age<0||age>6*3600000||health.last_remaining==null||Number(health.last_remaining)<=100||Number(health.blocked_until_ms)>timestamp||Number(health.unresolved)!==0)throw Error('COLLEGE_QUOTA_ACCOUNT_UNRESOLVED');
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
