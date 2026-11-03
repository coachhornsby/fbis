// Owner-only CBB delivery. No D1, provider fetches, AI, schedules, or writes.
// Cloudflare Access enforces the route; we independently verify its signed JWT.
const noStore={'cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','vary':'Cookie'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...noStore,'content-type':'application/json; charset=utf-8'}});
const dateIsValid=(s)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const decodePart=(segment)=>{if(!/^[A-Za-z0-9_-]+$/.test(segment)||segment.length>12000)throw Error('BAD_JWT_SEGMENT');return Uint8Array.from(atob(segment.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-segment.length%4)%4)),c=>c.charCodeAt(0));};
const parsePart=(s)=>JSON.parse(new TextDecoder().decode(decodePart(s)));
export async function verifyOwnerAccess(token,env,{fetchFn=fetch,now=Date.now(),cryptoImpl=crypto}={}){
 try{
  const domain=String(env?.FBIS_ACCESS_TEAM_DOMAIN||'').trim().toLowerCase();
  const audiences=String(env?.FBIS_ACCESS_AUDIENCES||'').split(',').map(x=>x.trim()).filter(Boolean);
  const owner=String(env?.FBIS_PRIVATE_OWNER_EMAIL||'').trim().toLowerCase();
  if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain)||!audiences.length||!owner||!token||token.length>12000)return false;
  const pieces=token.split('.');if(pieces.length!==3)return false;
  const header=parsePart(pieces[0]),claims=parsePart(pieces[1]);
  if(header?.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200)return false;
  if(claims?.iss!==`https://${domain}`||String(claims.email||'').toLowerCase()!==owner)return false;
  const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(!aud.some(x=>audiences.includes(x)))return false;
  const second=Math.floor(now/1000);
  if(!Number.isInteger(claims.exp)||claims.exp<=second||!Number.isInteger(claims.iat)||claims.iat>second+60)return false;
  if(claims.nbf!=null&&(!Number.isInteger(claims.nbf)||claims.nbf>second+60))return false;
  const cert=await fetchFn(`https://${domain}/cdn-cgi/access/certs`,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(2500)});
  if(!cert.ok)return false;
  const keys=(await cert.json())?.keys;
  if(!Array.isArray(keys)||keys.length>30)return false;
  const jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA');
  if(!jwk)return false;
  const key=await cryptoImpl.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return await cryptoImpl.subtle.verify('RSASSA-PKCS1-v1_5',key,decodePart(pieces[2]),new TextEncoder().encode(pieces[0]+'.'+pieces[1]));
 }catch{return false;}
}
const readBounded=async(bucket,key,maxBytes)=>{const obj=await bucket.get(key);if(!obj)return null;if((obj.size||0)>maxBytes)throw Error('OVERSIZED_PRIVATE_OBJECT');const text=await obj.text();if(text.length>maxBytes)throw Error('OVERSIZED_PRIVATE_OBJECT');return JSON.parse(text);};
export async function onRequestGet({request,env,params}){
 const date=String(params?.date||'');
 if(!dateIsValid(date))return json({state:'INVALID_DATE'},400);
 if(!env?.FBIS_PRIVATE_CBB)return json({state:'PRIVATE_STORAGE_UNAVAILABLE'},503);
 const permitted=await verifyOwnerAccess(request.headers.get('Cf-Access-Jwt-Assertion'),env);
 if(!permitted)return json({state:'PRIVATE_AUTH_REQUIRED'},401);
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
