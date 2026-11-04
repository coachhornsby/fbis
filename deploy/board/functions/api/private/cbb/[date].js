// Owner-only CBB delivery. No D1, provider fetches, AI, schedules, or writes.
// Cloudflare Access enforces the route; we independently verify its signed JWT.
const noStore={'cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','vary':'Cookie'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...noStore,'content-type':'application/json; charset=utf-8'}});
const dateIsValid=(s)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const decodePart=(segment)=>{if(!/^[A-Za-z0-9_-]+$/.test(segment)||segment.length>12000)throw Error('BAD_JWT_SEGMENT');return Uint8Array.from(atob(segment.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-segment.length%4)%4)),c=>c.charCodeAt(0));};
const parsePart=(s)=>JSON.parse(new TextDecoder().decode(decodePart(s)));
export function accessCookieToken(cookieHeader){
 const pieces=String(cookieHeader||'').split(';');
 for(const p of pieces){const i=p.indexOf('=');if(i<0)continue;
  if(p.slice(0,i).trim().toLowerCase()==='cf_authorization'){const value=p.slice(i+1).trim();return value.length<=12000?value:null;}
 }
 return null;
}
// All sources must be cryptographically verified; a cookie is never trusted alone.
export async function inspectOwnerAccess(token,env,{fetchFn=fetch,now=Date.now(),cryptoImpl=crypto}={}){
 try{
  const domain=String(env?.FBIS_ACCESS_TEAM_DOMAIN||'').trim().toLowerCase();
  const audiences=String(env?.FBIS_ACCESS_AUDIENCES||'').split(',').map(x=>x.trim()).filter(Boolean);
  const owner=String(env?.FBIS_PRIVATE_OWNER_EMAIL||'').trim().toLowerCase();
  if(!/^[a-z0-9-]+\\.cloudflareaccess\\.com$/.test(domain)||!audiences.length||!owner)return {ok:false,reason:'AUTH_CONFIG_MISSING'};
  if(!token||typeof token!=='string'||token.length>12000)return {ok:false,reason:'ACCESS_TOKEN_MISSING'};
  const parts=token.split('.');if(parts.length!==3)return {ok:false,reason:'ACCESS_TOKEN_MALFORMED'};
  const header=parsePart(parts[0]),claims=parsePart(parts[1]);
  if(header?.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200)return {ok:false,reason:'ACCESS_TOKEN_HEADER_INVALID'};
  if(claims?.iss!==`https://${domain}`||String(claims?.email||'').trim().toLowerCase()!==owner)return {ok:false,reason:'ACCESS_IDENTITY_INVALID'};
  const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(!aud.some(x=>audiences.includes(x)))return {ok:false,reason:'ACCESS_AUDIENCE_INVALID'};
  const seconds=Math.floor(now/1000);
  if(!Number.isInteger(claims.exp)||claims.exp<=seconds||!Number.isInteger(claims.iat)||claims.iat>seconds+60)return {ok:false,reason:'ACCESS_TOKEN_EXPIRED'};
  if(claims.nbf!=null&&(!Number.isInteger(claims.nbf)||claims.nbf>seconds+60))return {ok:false,reason:'ACCESS_TOKEN_NOT_YET_VALID'};
  let response;
  try{response=await fetchFn(`https://${domain}/cdn-cgi/access/certs`,{redirect:'follow',signal:AbortSignal.timeout(6500)});}
  catch{return {ok:false,reason:'ACCESS_KEYS_UNAVAILABLE'};}
  if(!response?.ok)return {ok:false,reason:'ACCESS_KEYS_UNAVAILABLE'};
  const keyset=(await response.json())?.keys;
  if(!Array.isArray(keyset)||keyset.length>30)return {ok:false,reason:'ACCESS_KEYS_INVALID'};
  const jwk=keyset.find(k=>k.kid===header.kid&&k.kty==='RSA');
  if(!jwk)return {ok:false,reason:'ACCESS_SIGNING_KEY_UNKNOWN'};
  const key=await cryptoImpl.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const good=await cryptoImpl.subtle.verify('RSASSA-PKCS1-v1_5',key,decodePart(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  return {ok:Boolean(good),reason:good?'VALID_ACCESS':'ACCESS_SIGNATURE_INVALID'};
 }catch{return {ok:false,reason:'ACCESS_TOKEN_VERIFICATION_ERROR'};}
}
export async function verifyOwnerAccess(token,env,options){return (await inspectOwnerAccess(token,env,options)).ok;}
export async function inspectRequestOwnerAccess(request,env,options){
 const assertion=request.headers.get('Cf-Access-Jwt-Assertion');
 let result=await inspectOwnerAccess(assertion,env,options);
 if(result.ok)return result;
 const cookie=accessCookieToken(request.headers.get('Cookie'));
 // Access can forward a signed CF_Authorization cookie without the assertion header.
 if(cookie&&cookie!==assertion)return inspectOwnerAccess(cookie,env,options);
 return result;
}
const readBounded=async(bucket,key,maxBytes)=>{const obj=await bucket.get(key);if(!obj)return null;if((obj.size||0)>maxBytes)throw Error('OVERSIZED_PRIVATE_OBJECT');const text=await obj.text();if(text.length>maxBytes)throw Error('OVERSIZED_PRIVATE_OBJECT');return JSON.parse(text);};
export async function onRequestGet({request,env,params}){
 const date=String(params?.date||'');
 if(!dateIsValid(date))return json({state:'INVALID_DATE'},400);
 if(!env?.FBIS_PRIVATE_CBB)return json({state:'PRIVATE_STORAGE_UNAVAILABLE'},503);
 const result=await inspectRequestOwnerAccess(request,env);
 if(!result.ok)return json({state:'PRIVATE_AUTH_REQUIRED',authStage:result.reason,message:'Cloudflare sign-in was not verified by the private CBB endpoint. No forecast data was sent.'},401);
 if(new URL(request.url).searchParams.get('login')==='1')return Response.redirect(new URL('/?sport=cbb&date='+date,request.url),303);
 try{
  const packet=await readBounded(env.FBIS_PRIVATE_CBB,'private/cbb/projections/'+date+'.json',1024*1024);
  if(!packet)return json({state:'NO_PRIVATE_PROJECTION',date},404);
  if(packet.version!==1||packet.visibility!=='PRIVATE_PERSONAL_ANALYSIS'||!Number.isFinite(Date.parse(packet.expiresAt))||
      !Array.isArray(packet.events)||packet.events.length>1000||packet.events.some(e=>e.date!==date)||
      packet.canAuthorizeWager===true)return json({state:'INVALID_PRIVATE_PACKET'},503);
  const stored=await readBounded(env.FBIS_PRIVATE_CBB,'private/cbb/markets/'+date+'.json',1024*1024);
  const validOffers=stored?.version===1&&stored?.sport==='cbb'&&stored?.date===date&&
       Array.isArray(stored.offers)&&stored.offers.length<=10000;
  // Markets and projections have independent capture and expiration controls.
  return json({state:'PRIVATE_RESEARCH_ONLY',date,packet,markets:validOffers?{capturedAt:stored.capturedAt||null,offers:stored.offers}:null,
     meta:{projectionExpired:Date.now()>=Date.parse(packet.expiresAt),quoteSnapshotAvailable:validOffers,canAuthorizeWager:false}});
 }catch{return json({state:'PRIVATE_READ_FAILED'},503);}
}
export async function onRequest(){return json({state:'METHOD_NOT_ALLOWED'},405);}
