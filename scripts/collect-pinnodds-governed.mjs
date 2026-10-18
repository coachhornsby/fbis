import {createGitHubOidcProvider} from './github-oidc.mjs';
import {pinnoddsWindow,pinnoddsWindowComplete,pinnoddsDueWindow} from './lib/pinnoddsSchedule.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
async function main(){
const base=process.env.BASE||'https://fbis-myz.pages.dev',worker='https://fbis-orchestrator.coachhornsby.workers.dev';
const secret=process.env.HARVEST_SECRET;
if(!secret)throw Error('EXISTING_COLLECTION_AUTH_REQUIRED');
// GitHub OIDC credentials expire during 15-slot collections; obtain fresh tokens per window.
const getOidcToken=createGitHubOidcProvider();
// One-time recovery may pull the next *existing* full slot early. The regular
// scheduled collector reuses the same durable runId, preventing double quota use.
let window=process.env.PINNODDS_RESTORE_ONCE==='1'
 ? pinnoddsWindow(new Date('2026-10-16T18:23:00Z')) : pinnoddsWindow();
// Before reserving billable requests, read R2 receipts through the public
// read-only status API. Failed status => fail closed, no provider call.
const response=await fetch(base+'/api/pinnodds-status',{headers:{'cache-control':'no-store'},signal:AbortSignal.timeout(20000)});
if(!response.ok)throw Error('PINNODDS_STATUS_HTTP_'+response.status);
const status=await response.json();
if(process.env.PINNODDS_RESTORE_ONCE!=='1')window=pinnoddsDueWindow(status);
const {scope,runId}=window;
if(pinnoddsWindowComplete(status,window)){
 console.log(JSON.stringify({ok:true,status:'already_collected_slot',scope,runId,paidProviderCalls:0}));
 return;
}

await mkdir('artifacts',{recursive:true});
async function call(path,body,{upstream=false}={}){
 const attempts=upstream?1:4;
 for(let attempt=0;attempt<attempts;attempt++){
  try{const headers={'content-type':'application/json',...(upstream?{authorization:'Bearer '+await getOidcToken()}:{'x-harvest-secret':secret})};
   const response=await fetch((upstream?worker:base)+path,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(upstream?65000:150000)});const result=await response.json();
   if(!response.ok||result.ok!==true)throw Error(`COLLECTOR_${response.status}_${result.error||'RECONCILIATION_FAILED'}`);return result;
  }catch(error){if(attempt+1===attempts)throw error;await new Promise(resolve=>setTimeout(resolve,5000));}
 }
}
const reservation=await call('/api/pinnodds-capture',{operation:'reserve',runId,scope},{upstream:true});
await writeFile('artifacts/pinnodds-reservation.json',JSON.stringify(reservation,null,2));
const slots=[];
if(scope==='full'){for(const sportId of [1,2,3,4,5,6])for(const feed of ['prematch','live'])slots.push({kind:'board',sportId,feed});slots.push({kind:'health'});}
if(scope==='football'||scope==='football-drops')slots.push({kind:'board',sportId:5,feed:'prematch'});
if(scope!=='football')for(const feed of ['prematch','live'])slots.push({kind:'drops',feed});
const results=[],errors=[];
for(const slot of slots){
 try{
  // Never retry a chargeable provider request. Its slot is reserved before fetch.
  const capture=await call('/api/pinnodds-capture',{operation:'capture',runId,...slot},{upstream:true});
  await writeFile(`artifacts/pinnodds-capture-${capture.snapshotId}.json`,JSON.stringify(capture,null,2));
  const prepared=await call('/api/pinnodds-ingest',{operation:'prepare',snapshotId:capture.snapshotId});
  for(let batchIndex=0;batchIndex<prepared.batches;batchIndex++)await call('/api/pinnodds-ingest',{operation:'consume',snapshotId:capture.snapshotId,batchIndex});
  const reconciled=await call('/api/pinnodds-ingest',{operation:'reconcile',snapshotId:capture.snapshotId});
  await writeFile(`artifacts/pinnodds-result-${capture.snapshotId}.json`,JSON.stringify(reconciled,null,2));
  if(slot.kind==='drops'&&capture.dropBufferComplete!==true)throw Error('PROVIDER_DROP_BUFFER_COMPLETENESS_UNVERIFIED');
  results.push(reconciled);
 }catch(error){errors.push({...slot,error:error.message});}
}
const summary={ok:errors.length===0,runId,scope,requestsReserved:reservation.requestsReserved,results,errors,
 observations:results.reduce((n,r)=>n+r.persistedRows,0),matchedRows:results.reduce((n,r)=>n+r.matchedRows,0),
 providerSnapshotAtomic:false,providerQuoteClockVerified:false,readOnly:true,canAuthorizeWager:false};
await writeFile('artifacts/pinnodds-governed-complete.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify({ok:summary.ok,scope,requestsReserved:summary.requestsReserved,observations:summary.observations,matchedRows:summary.matchedRows,errors}));
if(errors.length)process.exitCode=1;

}
await main();
