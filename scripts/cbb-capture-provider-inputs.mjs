// Explicit operator capture only. Runs during a manual Pages build, never on a
// visitor request. Provider credentials remain in Cloudflare's secret environment.
// Raw sports data leaves the build only encrypted to the operator's one-time key.
import {mkdir,writeFile} from 'node:fs/promises';
import {createCipheriv,randomBytes,publicEncrypt,constants,createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const leaseRaw=process.env.FBIS_CBB_CAPTURE_LEASE_JSON,key=process.env.FBIS_CBB_CAPTURE_PUBLIC_KEY;
if(!leaseRaw&&!key)process.exit(0);
if(!leaseRaw||!key)throw Error('INCOMPLETE_CAPTURE_CONFIGURATION');
const lease=JSON.parse(leaseRaw);
if(!/^[a-z0-9-]{1,80}$/.test(lease.id)||(!Number.isFinite(Date.parse(lease.expiresAt))||Date.parse(lease.expiresAt)<=Date.now()||Date.parse(lease.expiresAt)-Date.now()>15*60000)||!Array.isArray(lease.requests)||lease.requests.length>6)throw Error('INVALID_CAPTURE_LEASE');
const collegeKey=process.env.CBBD_API_KEY||process.env.CFBD_API_KEY;
const kenpomKey=process.env.KENPOM_API_KEY;
const secrets=[collegeKey,kenpomKey].filter(Boolean);
const records=[];let calls=0,remaining=null;
async function read(url,bearer){
  if(++calls>12||Date.parse(lease.expiresAt)<=Date.now())throw Error('CAPTURE_LIMIT');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${bearer}`,Accept:'application/json'}});
  const cap=8*1024*1024,reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>cap){await reader.cancel();throw Error('CAPTURE_BYTE_LIMIT');}parts.push(value);}}finally{reader.releaseLock();}
  const raw=Buffer.concat(parts),text=raw.toString('utf8');
  if(secrets.some(s=>text.includes(s)))throw Error('SECRET_IN_PROVIDER_RESPONSE');
  let payload=null;try{payload=JSON.parse(text);}catch{}
  const remainingHeader=response.headers.get('X-CallLimit-Remaining');
  const quotaRemaining=/^\d+$/.test(remainingHeader||'')?Number(remainingHeader):null;
  return {url,status:response.status,ok:response.ok&&payload!==null,observedAt:new Date().toISOString(),bytes:size,
    sha256:createHash('sha256').update(raw).digest('hex'),remaining:quotaRemaining,payload};
}
if(collegeKey){for(const request of lease.requests){
  const u=new URL(request.url);
  if(u.origin!=='https://api.collegebasketballdata.com'||!['/teams/directory','/teams/roster','/ratings/adjusted','/stats/team/leaderboard','/games/teams'].includes(u.pathname))throw Error('INVALID_CAPTURE_SCOPE');
  // Durable quota reservations were made by the operator before this build.
  // The first response refreshes the shared allowance; unknown/low allowance stops.
  if(remaining!==null&&remaining<=106)break;
  let r;try{r=await read(request.url,collegeKey);}catch(error){records.push({url:request.url,ok:false,status:0,error:String(error.message)});break;}
  records.push({...r,reservation:{day:request.day,hash:request.hash}});remaining=r.remaining;
  if(!r.ok||remaining===null||remaining<=106)break;
}}else records.push({provider:'cbbd',ok:false,error:'NOT_CONFIGURED'});
if(kenpomKey){for(const endpoint of ['ratings','four-factors','pointdist','height','misc-stats','archive']){
  const u=new URL('https://kenpom.com/api.php');u.searchParams.set('endpoint',endpoint);u.searchParams.set('y','2027');
  if(endpoint==='archive')u.searchParams.set('preseason','true');
  let r;try{r=await read(u.toString(),kenpomKey);}catch(error){records.push({provider:'kenpom',ok:false,error:String(error.message)});break;}
  records.push(r);if([401,402,403,429].includes(r.status))break;
}}else records.push({provider:'kenpom',ok:false,error:'NOT_CONFIGURED'});
const raw=Buffer.from(JSON.stringify({version:1,id:lease.id,endingSeason:2027,calls,records}));
const compressed=gzipSync(raw),dataKey=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',dataKey,iv);
const ciphertext=Buffer.concat([cipher.update(compressed),cipher.final()]);
const wrappedKey=publicEncrypt({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},dataKey);
await mkdir('deploy/board/dist/private-transfer',{recursive:true});
await writeFile(`deploy/board/dist/private-transfer/${lease.id}.json`,JSON.stringify({version:1,algorithm:'RSA-OAEP-SHA256+A256GCM',id:lease.id,
  wrappedKey:wrappedKey.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64'),
  plaintextSha256:createHash('sha256').update(raw).digest('hex')}));
console.log('CBB operator capture encrypted; requests='+calls+'. No credentials or raw provider data published.');
