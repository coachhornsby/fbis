import {requireJobAdmission} from '../account-budget/admission.mjs';
export const ORIGIN='https://fbis-espn-mcp.coachhornsby.workers.dev';
export const RESOURCE=ORIGIN+'/mcp';
export const SCOPE='espn:read';
export const AUTH_JOB='services/espn-mcp/oauth.mjs';
export const AUTH_UNITS={requests:0,responseBytes:0,d1Queries:0,reads:0,writes:0,r2Lists:0,r2Reads:0,r2Writes:0,r2Bytes:0,doDurationMs:1000};
const encoder=new TextEncoder(),decoder=new TextDecoder();
const seconds=()=>Math.floor(Date.now()/1000);
export const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const unb64=s=>{if(!/^[A-Za-z0-9_-]+$/.test(s)||s.length>8192)throw Error('invalid_token');return Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));};
const signingKey=env=>{if(!env.ESPN_OAUTH_SIGNING_KEY||env.ESPN_OAUTH_SIGNING_KEY.length<43)throw Error('oauth_not_configured');return crypto.subtle.importKey('raw',encoder.encode(env.ESPN_OAUTH_SIGNING_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);};
export async function sign(env,kind,claims,ttl){const body=b64(encoder.encode(JSON.stringify({...claims,kind,iss:ORIGIN,iat:seconds(),exp:seconds()+ttl})));const sig=b64(new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(env),encoder.encode(body))));return 'fbis1.'+body+'.'+sig;}
export async function verify(env,token,kind){if(typeof token!=='string'||token.length>8192)throw Error('invalid_token');const [prefix,body,sig,...rest]=token.split('.');if(prefix!=='fbis1'||rest.length||!body||!sig)throw Error('invalid_token');if(!await crypto.subtle.verify('HMAC',await signingKey(env),unb64(sig),encoder.encode(body)))throw Error('invalid_token');const p=JSON.parse(decoder.decode(unb64(body)));if(p.kind!==kind||p.iss!==ORIGIN||!Number.isSafeInteger(p.exp)||!Number.isSafeInteger(p.iat)||p.exp<=seconds()||p.iat>seconds()+30||p.exp<=p.iat)throw Error('invalid_token');return p;}
export async function ownerKeyMatches(value,env){if(typeof value!=='string'||value.length>512||!env.ESPN_TOKEN_SHA256)return false;const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(value));const hash=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');let diff=hash.length^env.ESPN_TOKEN_SHA256.length;for(let i=0;i<hash.length;i++)diff|=hash.charCodeAt(i)^env.ESPN_TOKEN_SHA256.charCodeAt(i);return diff===0;}
export async function authorized(req,env){const h=req.headers.get('authorization');if(!h?.startsWith('Bearer '))return false;const token=h.slice(7);if(await ownerKeyMatches(token,env))return true;try{const p=await verify(env,token,'access');return p.aud===RESOURCE&&p.scope===SCOPE&&p.sub==='owner'&&typeof p.client_id==='string';}catch{return false;}}
const headers={'cache-control':'no-store',pragma:'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'content-type':'application/json','access-control-allow-origin':'*'}});
const error=(code,status=400)=>json({error:code},status);
export const unauthorized=()=>new Response('Authorization required',{status:401,headers:{...headers,'WWW-Authenticate':`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="${SCOPE}"`}});
export function allowedRedirect(uri){try{const u=new URL(uri);return u.origin==='https://chatgpt.com'&&!u.search&&!u.hash&&!u.username&&!u.password&&(u.pathname==='/connector_platform_oauth_redirect'||/^\/connector\/oauth\/[a-zA-Z0-9_-]{1,160}$/.test(u.pathname));}catch{return false;}}
const metadata={issuer:ORIGIN,authorization_endpoint:ORIGIN+'/authorize',token_endpoint:ORIGIN+'/token',registration_endpoint:ORIGIN+'/register',revocation_endpoint:ORIGIN+'/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:[SCOPE],authorization_response_iss_parameter_supported:true};
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
async function body(req,max=12288){if(Number(req.headers.get('content-length')||0)>max)throw Error('request_too_large');const reader=req.body?.getReader();if(!reader)return '';const chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Error('request_too_large');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}const out=new Uint8Array(size);let i=0;for(const c of chunks){out.set(c,i);i+=c.length;}return decoder.decode(out);}
function unique(params){const keys=[...params.keys()];if(new Set(keys).size!==keys.length)throw Error('invalid_request');return Object.fromEntries(params);}
async function client(env,id){const p=await verify(env,id,'client');if(!Array.isArray(p.redirect_uris)||p.redirect_uris.length<1||p.redirect_uris.length>2||!p.redirect_uris.every(allowedRedirect))throw Error('invalid_client');return p;}
async function authorizationRequest(env,params){const a=unique(params);const c=await client(env,a.client_id);if(a.response_type!=='code'||!c.redirect_uris.includes(a.redirect_uri)||!allowedRedirect(a.redirect_uri)||a.resource!==RESOURCE||a.scope!==SCOPE||a.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(a.code_challenge||'')||!a.state||a.state.length>1024)throw Error('invalid_request');return {client_id:a.client_id,redirect_uri:a.redirect_uri,resource:RESOURCE,scope:SCOPE,code_challenge:a.code_challenge,state:a.state};}
function form(request,nonce,message=''){return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect FBIS ESPN</title><style>body{background:#101014;color:#fff;font:18px system-ui;max-width:600px;margin:10vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:14px;margin:14px 0;border-radius:8px}button{background:#e5b84a;color:#111;border:0}p{line-height:1.5}label{font-weight:600}.error{color:#ffb4b4}</style><h1>Connect FBIS ESPN</h1><p>Authorize ChatGPT to read ESPN schedules, scores, team identities and game summaries through your FBIS connector.</p><p>This connection cannot place wagers or change your models.</p><form method="post" action="/authorize"><input type="hidden" name="request" value="${escape(request)}"><label for="owner_key">Your existing FBIS ESPN connection key</label><input id="owner_key" name="owner_key" type="password" autocomplete="off" maxlength="512" required><p>The key stays on this FBIS server. It is never sent to ChatGPT. You can find it in the Authorization header of your original FBIS ESPN plugin ZIP, inside mcp.json or .mcp.json. Enter the key without the word Bearer.</p>${message?`<p class="error">${escape(message)}</p>`:''}<button type="submit">Authorize read-only access</button></form></html>`,{headers:{...headers,'content-type':'text/html;charset=utf-8','set-cookie':`__Host-fbis-espn-oauth=${nonce}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'x-frame-options':'DENY'}});}
async function mutate(env,request,deps){const a=await(deps.admit||requireJobAdmission)(env,AUTH_JOB,crypto.randomUUID());if(!a?.allowed||a.expiresAtMs<=Date.now()||a.maxUnits?.doDurationMs<1000)throw Error('ACCOUNT_BUDGET_STOP');if(!env.ESPN_OAUTH_STATE?.getByName)throw Error('OAUTH_STATE_UNAVAILABLE');return env.ESPN_OAUTH_STATE.getByName('owner').apply(request);}
async function tokens(env,clientId,family,refreshId){return {access_token:await sign(env,'access',{sub:'owner',aud:RESOURCE,scope:SCOPE,client_id:clientId},3600),token_type:'Bearer',expires_in:3600,scope:SCOPE,refresh_token:await sign(env,'refresh',{sub:'owner',aud:RESOURCE,scope:SCOPE,client_id:clientId,family,jti:refreshId},30*86400)};}
export async function oauthRoute(req,env,deps={}){
 const u=new URL(req.url);const path=u.pathname;
 if(!['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp','/.well-known/oauth-authorization-server','/register','/authorize','/token','/revoke'].includes(path))return null;
 if(u.origin!==ORIGIN)return error('invalid_origin');
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type'}});
 try{
  if(path.startsWith('/.well-known/')){if(req.method!=='GET')return error('method_not_allowed',405);if(path.includes('protected-resource'))return json({resource:RESOURCE,authorization_servers:[ORIGIN],scopes_supported:[SCOPE],bearer_methods_supported:['header'],resource_name:'FBIS ESPN read-only'});return json(metadata);}
  if(path==='/register'){
   if(req.method!=='POST')return error('method_not_allowed',405);
   if(!req.headers.get('content-type')?.startsWith('application/json'))return error('invalid_request');
   const p=JSON.parse(await body(req,4096));
   if(!Array.isArray(p.redirect_uris)||p.redirect_uris.length<1||p.redirect_uris.length>2||!p.redirect_uris.every(allowedRedirect)||new Set(p.redirect_uris).size!==p.redirect_uris.length||p.token_endpoint_auth_method&&p.token_endpoint_auth_method!=='none'||p.grant_types&&(!Array.isArray(p.grant_types)||p.grant_types.some(x=>!['authorization_code','refresh_token'].includes(x)))||p.response_types&&(!Array.isArray(p.response_types)||p.response_types.some(x=>x!=='code')))return error('invalid_client_metadata');
   const client_id=await sign(env,'client',{redirect_uris:p.redirect_uris},365*86400);
   return json({client_id,client_id_issued_at:seconds(),redirect_uris:p.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:SCOPE},201);
  }
  if(path==='/authorize'){
   if(req.method==='GET'){const a=await authorizationRequest(env,u.searchParams);const nonce=crypto.randomUUID();return form(await sign(env,'request',{...a,nonce},600),nonce);}
   if(req.method!=='POST')return error('method_not_allowed',405);
   if(req.headers.get('origin')!==ORIGIN||!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return error('invalid_request');
   const f=unique(new URLSearchParams(await body(req)));const a=await verify(env,f.request,'request');
   const cookie=req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-fbis-espn-oauth='))?.slice('__Host-fbis-espn-oauth='.length);
   if(!cookie||cookie!==a.nonce)return error('invalid_request');
   // Revalidate the signed client's registered redirect; never redirect on bad input or failed owner login.
   const c=await client(env,a.client_id);if(!c.redirect_uris.includes(a.redirect_uri)||!allowedRedirect(a.redirect_uri)||a.resource!==RESOURCE||a.scope!==SCOPE)return error('invalid_request');
   if(!await ownerKeyMatches(f.owner_key,env))return form(f.request,a.nonce,'The connection key was not accepted.');
   const code=await sign(env,'code',{sub:'owner',aud:RESOURCE,client_id:a.client_id,redirect_uri:a.redirect_uri,scope:SCOPE,code_challenge:a.code_challenge,jti:crypto.randomUUID()},120);
   const redirect=new URL(a.redirect_uri);redirect.searchParams.set('code',code);redirect.searchParams.set('state',a.state);redirect.searchParams.set('iss',ORIGIN);
   return new Response(null,{status:303,headers:{...headers,location:redirect.toString(),'set-cookie':'__Host-fbis-espn-oauth=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'}});
  }
  if(req.method!=='POST')return error('method_not_allowed',405);
  if(req.headers.has('authorization')||!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return error('invalid_request');
  const p=unique(new URLSearchParams(await body(req)));await client(env,p.client_id);
  if(path==='/revoke'){
   let t;try{t=await verify(env,p.token,'refresh');}catch{return json({});}
   if(t.client_id!==p.client_id)return json({});
   await mutate(env,{op:'revoke',family:t.family,client_id:t.client_id},deps);return json({});
  }
  if(p.resource!==RESOURCE)return error('invalid_target');
  if(p.grant_type==='authorization_code'){
   const t=await verify(env,p.code,'code');if(t.aud!==RESOURCE||t.scope!==SCOPE||t.client_id!==p.client_id||t.redirect_uri!==p.redirect_uri||!/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier||''))return error('invalid_grant');
   const challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(p.code_verifier))));if(challenge!==t.code_challenge)return error('invalid_grant');
   const family=crypto.randomUUID(),jti=crypto.randomUUID();const saved=await mutate(env,{op:'exchange',code:t.jti,codeExp:t.exp,family,jti,client_id:t.client_id,expires:seconds()+30*86400},deps);if(!saved.ok)return error(saved.error,saved.error==='temporarily_unavailable'?503:400);
   return json(await tokens(env,t.client_id,family,jti));
  }
  if(p.grant_type==='refresh_token'){
   const t=await verify(env,p.refresh_token,'refresh');if(t.client_id!==p.client_id||t.aud!==RESOURCE||t.scope!==SCOPE||p.scope&&p.scope!==SCOPE)return error('invalid_grant');const jti=crypto.randomUUID();const saved=await mutate(env,{op:'refresh',family:t.family,jti:t.jti,nextJti:jti,client_id:t.client_id},deps);if(!saved.ok)return error(saved.error,saved.error==='temporarily_unavailable'?503:400);
   return json(await tokens(env,t.client_id,t.family,jti));
  }
  return error('unsupported_grant_type');
 }catch(e){const code=e.message;if(['ACCOUNT_BUDGET_STOP','ACCOUNT_BUDGET_BINDING_REQUIRED','CYCLE_ALLOCATION_EXHAUSTED','ACCOUNT_UNIT_STOP','OAUTH_STATE_UNAVAILABLE','oauth_not_configured','MISSING_OR_STALE_COST_EVIDENCE'].includes(code))return error('temporarily_unavailable',503);return error(code==='invalid_client'?'invalid_client':path==='/token'?'invalid_grant':'invalid_request');}
}
