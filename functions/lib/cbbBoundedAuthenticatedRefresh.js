/** Manually invoked, credential-injected runner. No D1, schedules or model changes. */
export const CBB_REFRESH_REQUESTS=Object.freeze([
 {provider:'cbbd',name:'adjusted-current',url:'https://api.collegebasketballdata.com/ratings/adjusted?season=2027'},
 {provider:'kenpom',name:'ratings',url:'https://kenpom.com/api.php?endpoint=ratings&y=2027'}
]);
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function runCbbAuthenticatedRefresh({lease,keys,claimOnce,save,fetchFn=fetch,now=()=>Date.now()}){
 const start=now(),issued=Date.parse(lease?.issuedAt),expires=Date.parse(lease?.expiresAt);
 if(!/^[a-zA-Z0-9_-]{12,80}$/.test(lease?.runId||'')||![start,issued,expires].every(Number.isFinite)||issued>start||expires<=start||expires<=issued||expires-issued>10*60000||lease?.maximumRequests!==2||lease?.season!==2027)throw Error('INVALID_OR_EXPIRED_LEASE');
 const missing=['cbbd','kenpom'].filter(p=>typeof keys?.[p]!=='string'||!keys[p].trim());
 if(missing.length)return {state:'CREDENTIALS_MISSING',missing,attempts:0,records:[],canAuthorizeWager:false};
 if(!await claimOnce(lease.runId))return {state:'ALREADY_CONSUMED',attempts:0,records:[],canAuthorizeWager:false};
 const records=[];let attempts=0,state='CAPTURED';
 for(const source of CBB_REFRESH_REQUESTS){
  if(now()>=expires){state='LEASE_EXPIRED';break;}
  const beganAt=new Date(now()).toISOString();let response;
  try{attempts++;response=await fetchFn(source.url,{method:'GET',redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+keys[source.provider],Accept:'application/json','User-Agent':'FBIS-CBB-Bounded-Refresh/1.0'}});}
  catch{records.push({...source,status:0,error:'TRANSPORT_ERROR',beganAt});state='STOPPED';break;}
  if(!response.ok){await response.body?.cancel();records.push({...source,status:response.status,error:'HTTP_STOP',beganAt});state='STOPPED';break;}
  try{
   const reader=response.body?.getReader();if(!reader)throw Error('EMPTY_BODY');const parts=[];let size=0;
   try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>4*1024*1024){await reader.cancel();throw Error('BYTE_LIMIT');}parts.push(value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.byteLength;}
   const text=new TextDecoder().decode(bytes);
   if(Object.values(keys).some(k=>text.includes(k)))throw Error('SECRET_IN_RESPONSE');
   let rows;try{rows=JSON.parse(text);}catch{throw Error('INVALID_JSON');}
   if(!Array.isArray(rows)||rows.length>=3000)throw Error('UNPROVEN_RESPONSE_COMPLETENESS');
   if(rows.some(r=>Number(r?.season??r?.Season)!==2027))throw Error('RESPONSE_SEASON_MISMATCH');
   const rem=response.headers.get('X-CallLimit-Remaining');
   const metadata={...source,status:response.status,beganAt,observedAt:new Date(now()).toISOString(),serverDate:response.headers.get('Date'),lastModified:response.headers.get('Last-Modified'),rows:rows.length,bytes:size,sha256:await digest(bytes),remaining:source.provider==='cbbd'&&/^\d+$/.test(rem||'')?Number(rem):null};
   await save(source.name,source.provider,bytes,metadata);records.push(metadata);
   if(source.provider==='cbbd'&&(metadata.remaining===null||metadata.remaining<=100)){state='PROVIDER_QUOTA_UNKNOWN_OR_LOW';break;}
  }catch(e){const allowed=['EMPTY_BODY','BYTE_LIMIT','SECRET_IN_RESPONSE','INVALID_JSON','UNPROVEN_RESPONSE_COMPLETENESS','RESPONSE_SEASON_MISMATCH'];records.push({...source,status:response.status,error:allowed.includes(e?.message)?e.message:'CAPTURE_STORAGE_OR_VALIDATION_FAILED',beganAt});state='STOPPED';break;}
 }
 if(state==='CAPTURED'&&records.length!==2)state='INCOMPLETE';
 return {runId:lease.runId,state,attempts,records,projectionReady:false,automaticCollectorsPaused:true,canAuthorizeWager:false};
}
