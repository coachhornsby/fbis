import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,webcrypto} from 'node:crypto';
import {inspectOwnerAccess,inspectRequestOwnerAccess,accessCookieToken,onRequestGet} from '../deploy/board/functions/api/private/cbb/[date].js';

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const kid='unit-test-key';
const jwk={...publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'};
const audience='unit-test-audience';
const domain='unit-test.cloudflareaccess.com';
const owner='owner@example.com';
const env={FBIS_ACCESS_TEAM_DOMAIN:domain,FBIS_ACCESS_AUDIENCES:audience,FBIS_PRIVATE_OWNER_EMAIL:owner};
const now=Date.parse('2026-11-04T12:00:00Z');
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
function token(claimOverrides={},signKey=privateKey){
 const claims={iss:'https://'+domain,aud:[audience],email:owner,iat:Math.floor(now/1000)-30,exp:Math.floor(now/1000)+3600,nbf:Math.floor(now/1000)-30,...claimOverrides};
 const text=encode({alg:'RS256',kid,typ:'JWT'})+'.'+encode(claims);
 return text+'.'+sign('RSA-SHA256',Buffer.from(text),signKey).toString('base64url');
}
const options={now,cryptoImpl:webcrypto,fetchFn:async()=>({ok:true,json:async()=>({keys:[jwk]})})};

test('valid owner signed JWT is accepted',async()=>{
 const res=await inspectOwnerAccess(token(),env,options);
 assert.deepEqual(res,{ok:true,reason:'VALID_ACCESS'});
});
test('signed CF_Authorization cookie works when assertion header is missing',async()=>{
 const req=new Request('https://fbis-myz.pages.dev/api/private/cbb/2026-11-02',{headers:{cookie:'other=hello; CF_Authorization='+token()+'; extra=world'}});
 const res=await inspectRequestOwnerAccess(req,env,options);
 assert.equal(res.ok,true);
 assert.equal(accessCookieToken('foo=bar; cf_authorization='+token()),token());
});
test('reject missing token and malformed cookie',async()=>{
 assert.equal((await inspectRequestOwnerAccess(new Request('https://example.com/'),env,options)).ok,false);
 assert.equal(accessCookieToken('CF_Authorization='+'a'.repeat(13000)),null);
});
test('reject wrong identity, audience, expired, and future tokens',async()=>{
 for(const claims of [{email:'other@example.com'},{aud:['other']},{exp:Math.floor(now/1000)-1},{nbf:Math.floor(now/1000)+400}]){
  const res=await inspectOwnerAccess(token(claims),env,options);
  assert.equal(res.ok,false,JSON.stringify(claims));
 }
});
test('reject same claims with forged signing key',async()=>{
 const other=generateKeyPairSync('rsa',{modulusLength:2048});
 assert.equal((await inspectOwnerAccess(token({},other.privateKey),env,options)).ok,false);
});
test('reject unavailable certificate lookup',async()=>{
 const opts={...options,fetchFn:async()=>{throw Error('network unavailable')}};
 assert.deepEqual(await inspectOwnerAccess(token(),env,opts),{ok:false,reason:'ACCESS_KEYS_UNAVAILABLE'});
});
test('API fails closed without auth and never invokes R2',async()=>{
 let reads=0;
 const fake={...env,FBIS_PRIVATE_CBB:{get:async()=>{reads++;return null;}}};
 const response=await onRequestGet({request:new Request('https://example.com/api/private/cbb/2026-11-02'),env:fake,params:{date:'2026-11-02'}});
 assert.equal(response.status,401);
 const p=await response.json();assert.equal(p.state,'PRIVATE_AUTH_REQUIRED');assert.equal(reads,0);
});
test('invalid date fails closed with no read',async()=>{
 const response=await onRequestGet({request:new Request('https://example.com/api/private/cbb/2026-11-32'),env,params:{date:'2026-11-32'}});
 assert.equal(response.status,400);
});
