// One reviewed GitHub run only. Separate audience cannot authenticate broad routes.
const ISSUER='https://token.actions.githubusercontent.com';
const REPO='coachhornsby/fbis';
const WORKFLOW=REPO+'/.github/workflows/fbis-nfl-verified-once.yml@refs/heads/main';
const KEYS=['repositoryId','ownerId','workflowRef','sha','runId','runAttempt','outputDate','notBefore','expiresAt'];
export function validateNflOidcGrant(grant,now=Date.now()){
 if(typeof grant?.outputDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(grant.outputDate)||!Number.isFinite(Date.parse(grant.outputDate+'T12:00:00Z'))||new Date(grant.outputDate+'T12:00:00Z').toISOString().slice(0,10)!==grant.outputDate)throw Error('NFL_OIDC_DATE_INVALID');
 if(!Number.isSafeInteger(now)||!grant||Object.keys(grant).sort().join('|')!==[...KEYS].sort().join('|')||grant.repositoryId!=='1347524754'||grant.ownerId!=='220085182'||grant.workflowRef!==WORKFLOW||! /^[a-f0-9]{40}$/.test(grant.sha)||! /^[1-9][0-9]{0,19}$/.test(grant.runId)||grant.runAttempt!=='1'||!Number.isSafeInteger(grant.notBefore)||!Number.isSafeInteger(grant.expiresAt)||grant.expiresAt<=grant.notBefore||grant.expiresAt-grant.notBefore>3600000||now<grant.notBefore||now>=grant.expiresAt)throw Error('NFL_OIDC_GRANT_INVALID');
 return {...grant,audience:'fbis-nfl-once:'+grant.runId};
}
const decode=s=>{if(!/^[A-Za-z0-9_-]+$/.test(s))throw Error('JWT_ENCODING');return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));};
export async function verifyNflScopedGithubIdentity(token,grant,{clock=()=>Date.now(),now=clock(),fetchImpl=fetch,subtle=crypto.subtle}={}){
 try{
  const g=validateNflOidcGrant(grant,now);
  if(typeof token!=='string'||token.length>16000)return false;
  const parts=token.split('.');if(parts.length!==3)return false;
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),c=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  const sec=Math.floor(now/1000);
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200||header.jku||header.jwk||header.x5u||header.crit)return false;
  if(c.iss!==ISSUER||c.aud!==g.audience||c.repository!==REPO||c.repository_id!==g.repositoryId||c.repository_owner_id!==g.ownerId||c.ref!=='refs/heads/main'||c.ref_type!=='branch'||!['repo:'+REPO+':ref:refs/heads/main','repo:coachhornsby@220085182/fbis@1347524754:ref:refs/heads/main'].includes(c.sub)||c.workflow_ref!==g.workflowRef||c.workflow_sha!==g.sha||c.sha!==g.sha||c.run_id!==g.runId||c.run_attempt!==g.runAttempt||c.event_name!=='workflow_dispatch')return false;
  if(![c.iat,c.nbf,c.exp].every(Number.isSafeInteger)||c.iat>sec||c.nbf>sec||c.exp<=sec||c.exp-c.iat>600||c.exp<=c.iat||sec-c.iat>300||c.iat*1000<g.notBefore)return false;
  // No redirects or token disclosure. Fetch only the fixed public issuer keyset.
  const response=await fetchImpl(ISSUER+'/.well-known/jwks',{redirect:'manual',signal:AbortSignal.timeout(5000)});
  if(response.status!==200)return false;
  if(!response.body)return false;
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>100000)return false;chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const keys=JSON.parse(body).keys;if(!Array.isArray(keys)||keys.length>20)return false;
  const matches=keys.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig');if(matches.length!==1)return false;
  const key=await subtle.importKey('jwk',matches[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))return false;
  const finishedAt=clock();validateNflOidcGrant(grant,finishedAt);
  if(finishedAt<now||c.exp*1000<=finishedAt||finishedAt-c.iat*1000>300000)return false;
  return {type:'nfl-scoped-github-oidc',runId:g.runId,runAttempt:g.runAttempt,sha:g.sha,outputDate:g.outputDate,expiresAt:Math.min(g.expiresAt,c.exp*1000)};
 }catch{return false;}
}
