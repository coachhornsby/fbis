import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import crypto from 'node:crypto';
import {isNflRestrictedWorkflow} from '../services/nfl/restrictedWorkflow.mjs';
import {scopeNflOperationLifetime,handleNflFeatureOperation} from '../workers/nfl-feature-operations-route.mjs';
const workflow='coachhornsby/fbis/.github/workflows/fbis-nfl-verified-once.yml@refs/heads/main';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
test('both actual legacy verifiers reject new workflow even with old broad audience before JWKS fetch',async()=>{
 for(const path of ['workers/sports-projection-orchestrator-worker.mjs','services/sports-projection-orchestrator/server.mjs']){
  const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');const start=source.indexOf('async function verifyGithubOidc('),end=source.indexOf('async function authorization(',start);const code=source.slice(start,end);let calls=0;
  const verify=new Function('crypto','decodePart','githubJwks','isNflRestrictedWorkflow','oidcAudience','allowedRepo',code+';return verifyGithubOidc;')(crypto,p=>JSON.parse(Buffer.from(p,'base64url')),async()=>{calls++;return [];},isNflRestrictedWorkflow,'sports-projection-orchestrator','coachhornsby/fbis');
  for(const field of ['workflow_ref','job_workflow_ref'])for(const ref of ['refs/heads/main','refs/heads/other','refs/tags/v1']){
   const claims={iss:'https://token.actions.githubusercontent.com',aud:'sports-projection-orchestrator',repository:'coachhornsby/fbis',ref:'refs/heads/main',exp:Math.floor(Date.now()/1000)+300,[field]:workflow.replace('refs/heads/main',ref)};
   assert.equal(await verify(b64({alg:'RS256',kid:'test'})+'.'+b64(claims)+'.a',{}),false);
  }assert.equal(calls,0,path);
 }
});
test('restriction preserves other workflows and route dispatch is before broad authentication',()=>{
 assert.equal(isNflRestrictedWorkflow({workflow_ref:'coachhornsby/fbis/.github/workflows/other.yml@refs/heads/main'}),false);
 const s=readFileSync(new URL('../workers/sports-projection-orchestrator-worker.mjs',import.meta.url),'utf8').split('async function handleFetch(request, env) {')[1];assert.ok(s.indexOf('handleNflFeatureOperation')<s.indexOf('authorization('));
});
test('scoped grant does not fall back to broad control token when scoped authentication fails',async()=>{
 const token='x'.repeat(40),r=new Request('https://private.invalid/api/nfl/features/inspect',{method:'POST',headers:{authorization:'Bearer '+token}});
 const res=await handleNflFeatureOperation(r,{ORCH_CONTROL_TOKEN:token,FBIS_NFL_FEATURE_OPERATIONS_ENABLED:'true',FBIS_NFL_RUNTIME_CPU_MS:'100',FBIS_NFL_OIDC_GRANT:'{}'});assert.equal(res.status,401);
});
test('lifetime expires before reservation or storage even when initial auth succeeded',async()=>{
 const real=Date.now;let now=1000,calls=0;Date.now=()=>now;
 try{const env=scopeNflOperationLifetime({R2_ARCHIVE:{get:async()=>++calls,head:async()=>++calls,put:async()=>++calls},FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async()=>++calls})}},2000,'2026-11-09');
  now=2000;assert.throws(()=>env.FBIS_ACCOUNT_BUDGET.getByName('account'),/EXPIRED/);for(const k of ['get','head','put'])await assert.rejects(()=>env.R2_ARCHIVE[k]('key'),/EXPIRED/);assert.equal(calls,0);
 }finally{Date.now=real;}
});
test('expiry during reservation blocks subsequent storage',async()=>{
 const real=Date.now;let now=1000;Date.now=()=>now;try{const env=scopeNflOperationLifetime({FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async()=>{now=2000;return {};}})}},2000,'2026-11-09');await assert.rejects(()=>env.FBIS_ACCOUNT_BUDGET.getByName('account').reserve({}),/EXPIRED/);}finally{Date.now=real;}
});

test('scope is exactly two keys and cannot drift between inspection and publication dates',async()=>{
 const deadline=Date.now()+60000,calls=[];const base={R2_ARCHIVE:{get:async key=>calls.push(key),put:async key=>calls.push(key)}};
 const env=scopeNflOperationLifetime(base,deadline,'2026-11-09');assert.equal(env.FBIS_NFL_PACKET_INSPECTION_DATE,'2026-11-09');
 await env.R2_ARCHIVE.get('nfl/features/latest.json');await env.R2_ARCHIVE.put('private/nfl/projections/2026-11-09.json');
 for(const key of ['private/nfl/projections/2026-11-10.json','cfb/features/latest.json','nfl/features/other.json'])await assert.rejects(()=>env.R2_ARCHIVE.get(key),/KEY_BLOCKED/);
 assert.equal(calls.length,2);
 assert.throws(()=>scopeNflOperationLifetime({...base,FBIS_NFL_PACKET_INSPECTION_DATE:'2026-11-10'},deadline,'2026-11-09'),/DATE_MISMATCH/);
 assert.throws(()=>scopeNflOperationLifetime({...base,FBIS_NFL_PACKET_WRITE_APPROVAL:JSON.stringify({date:'2026-11-10'})},deadline,'2026-11-09'),/DATE_MISMATCH/);
});
test('valid signed one-run identity reaches only admitted fixed NFL source inspection',async()=>{
 const now=Date.now(),sec=Math.floor(now/1000),sha='a'.repeat(40),grant={repositoryId:'1347524754',ownerId:'220085182',workflowRef:workflow,sha,runId:'12345',runAttempt:'1',outputDate:'2026-11-09',notBefore:now-2000,expiresAt:now+60000};
 const pair=await crypto.webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.webcrypto.subtle.exportKey('jwk',pair.publicKey),kid:'gateway-test',alg:'RS256',use:'sig'};
 const claims={iss:'https://token.actions.githubusercontent.com',aud:'fbis-nfl-once:12345',repository:'coachhornsby/fbis',repository_id:grant.repositoryId,repository_owner_id:grant.ownerId,ref:'refs/heads/main',ref_type:'branch',sub:'repo:coachhornsby/fbis:ref:refs/heads/main',workflow_ref:workflow,workflow_sha:sha,sha,run_id:'12345',run_attempt:'1',event_name:'workflow_dispatch',iat:sec,nbf:sec,exp:sec+60};
 const body=b64({alg:'RS256',kid:'gateway-test'})+'.'+b64(claims),token=body+'.'+Buffer.from(await crypto.webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,Buffer.from(body))).toString('base64url');
 const {NFL_SNAPSHOT_INSPECTION_JOB:job,CERTIFIED_EXECUTION_JOBS}=await import('../services/account-budget/executionJobs.mjs');
 const previous=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');assert.equal(options.redirect,'manual');return new Response(JSON.stringify({keys:[jwk]}));};
 try{const env={FBIS_NFL_FEATURE_OPERATIONS_ENABLED:'true',FBIS_NFL_RUNTIME_CPU_MS:'100',FBIS_NFL_OIDC_GRANT:JSON.stringify(grant),CLOUDFLARE_ACCOUNT_ID:'test',FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async request=>{calls.push(request.job);return {allowed:true,...request,maxUnits:CERTIFIED_EXECUTION_JOBS[job].units,expiresAtMs:Date.now()+60000};}})},R2_ARCHIVE:{get:async key=>{calls.push(key);return {size:2,body:new Response('{}').body};}}};
  const response=await handleNflFeatureOperation(new Request('https://private.invalid/api/nfl/features/inspect',{method:'POST',headers:{authorization:'Bearer '+token}}),env);assert.equal(response.status,200);assert.equal((await response.json()).snapshotText,'{}');assert.deepEqual(calls,[job,'nfl/features/latest.json']);
 }finally{globalThis.fetch=previous;}
});
