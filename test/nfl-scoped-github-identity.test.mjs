import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
import {validateNflOidcGrant,verifyNflScopedGithubIdentity as verify} from '../services/nfl/scopedGithubIdentity.mjs';
const now=1804830000000,sec=now/1000,sha='a'.repeat(40);
const grant={repositoryId:'1347524754',ownerId:'220085182',workflowRef:'coachhornsby/fbis/.github/workflows/fbis-nfl-verified-once.yml@refs/heads/main',sha,runId:'12345',runAttempt:'1',outputDate:'2027-03-11',notBefore:now-1000,expiresAt:now+300000};
const claims={iss:'https://token.actions.githubusercontent.com',aud:'fbis-nfl-once:12345',repository:'coachhornsby/fbis',repository_id:grant.repositoryId,repository_owner_id:grant.ownerId,ref:'refs/heads/main',ref_type:'branch',sub:'repo:coachhornsby/fbis:ref:refs/heads/main',workflow_ref:grant.workflowRef,workflow_sha:sha,sha,run_id:'12345',run_attempt:'1',event_name:'workflow_dispatch',iat:sec,nbf:sec,exp:sec+300};
const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await webcrypto.subtle.exportKey('jwk',pair.publicKey),kid:'test',alg:'RS256',use:'sig'};
const b64=x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url');
async function sign(c=claims,h={alg:'RS256',kid:'test'}){const body=b64(h)+'.'+b64(c);return body+'.'+Buffer.from(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(body))).toString('base64url');}
const options={now,clock:()=>now,subtle:webcrypto.subtle,fetchImpl:async(url,opt)=>{assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');assert.equal(opt.redirect,'manual');return new Response(JSON.stringify({keys:[jwk]}));}};
test('exact single-run identity authenticates without disclosing token',async()=>{assert.equal((await verify(await sign(),grant,options)).runId,'12345');});
for(const [field,value]of Object.entries({aud:'sports-projection-orchestrator',repository:'evil/fbis',repository_id:'1',repository_owner_id:'2',ref:'refs/heads/dev',ref_type:'tag',sub:'repo:coachhornsby/fbis:environment:production',workflow_ref:'other',workflow_sha:'b'.repeat(40),sha:'b'.repeat(40),run_id:'12346',run_attempt:'2',event_name:'push',iat:sec+1,nbf:sec+1,exp:sec}))test('rejects changed claim '+field,async()=>{let fetched=false;assert.equal(await verify(await sign({...claims,[field]:value}),grant,{...options,fetchImpl:async()=>{fetched=true;throw Error();}}),false);assert.equal(fetched,false);});
test('rejects expired/overbroad/extra-field grant',()=>{for(const g of [{...grant,expiresAt:now},{...grant,expiresAt:now+7200000},{...grant,runAttempt:'2'},{...grant,other:true}])assert.throws(()=>validateNflOidcGrant(g,now));});
test('rejects invalid signature, remote key override and redirected keyset',async()=>{const token=await sign();const parts=token.split('.');parts[2]=b64('invalid');assert.equal(await verify(parts.join('.'),grant,options),false);assert.equal(await verify(await sign(claims,{alg:'RS256',kid:'test',jku:'https://evil.example'}),grant,options),false);assert.equal(await verify(token,grant,{...options,fetchImpl:async()=>new Response('',{status:302})}),false);});
test('rejects long lifetime and stale issued token',async()=>{for(const c of [{...claims,exp:sec+601},{...claims,iat:sec-301}])assert.equal(await verify(await sign(c),grant,options),false);});

test('invalid caller clock fails closed',async()=>{assert.equal(await verify(await sign(),grant,{...options,now:NaN}),false);});

test('accepts immutable-ID subject with same pinned IDs and main ref',async()=>{assert.equal((await verify(await sign({...claims,sub:'repo:coachhornsby@220085182/fbis@1347524754:ref:refs/heads/main'}),grant,options)).runId,'12345');assert.equal(await verify(await sign({...claims,sub:'repo:coachhornsby@1/fbis@1347524754:ref:refs/heads/main'}),grant,options),false);});

test('rejects grant expiring during key fetch and bounds streamed key bytes',async()=>{
 let current=now;assert.equal(await verify(await sign(),{...grant,expiresAt:now+100},{...options,clock:()=>current,fetchImpl:async()=>{current+=150;return new Response(JSON.stringify({keys:[jwk]}));}}),false);
 let cancelled=false;assert.equal(await verify(await sign(),grant,{...options,fetchImpl:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(100001));},cancel(){cancelled=true;}}))}),false);assert.equal(cancelled,true);
});

test('grant pins exactly one valid output date',()=>{for(const outputDate of [undefined,'2026-02-30','../other','2026-11-09/extra'])assert.throws(()=>validateNflOidcGrant({...grant,outputDate},now));});
