/** Drive bounded Pages operations. Secrets stay in headers, never artifacts. */
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.BASE||'https://fbis-myz.pages.dev',secret=process.env.HARVEST_SECRET;
if(!secret)throw Error('HARVEST_SECRET_REQUIRED');
const run=`run-${process.env.GITHUB_RUN_ID||Date.now()}-${process.env.GITHUB_RUN_ATTEMPT||1}`;
await mkdir('artifacts',{recursive:true});
async function call(body){
 for(let attempt=0;attempt<4;attempt++){
  try{const response=await fetch(base+'/api/polymarket-pages',{method:'POST',headers:{'content-type':'application/json','x-harvest-secret':secret},body:JSON.stringify(body),signal:AbortSignal.timeout(150000)});
   const result=await response.json();if(!response.ok||result.ok!==true)throw Error(`COLLECTOR_${response.status}_${result.error||'RECONCILIATION_FAILED'}`);return result;
  }catch(error){if(attempt===3)throw error;await new Promise(resolve=>setTimeout(resolve,5000));}
 }
}
async function traverse(kind,slug=null,sport=null){
 const pages=[],seen=new Set();let offset=0;
 for(let page=0;page<200;page++){
  const receiptId=`${run}-${slug||'catalogue'}-${offset}`;
  const receipt=await call({operation:'capture',receiptId,kind,slug,sport,offset});
  await writeFile(`artifacts/polymarket-page-${slug||'catalogue'}-${offset}.json`,JSON.stringify(receipt,null,2));
  // An ignored cursor must fail visibly rather than repeatedly collecting page one.
  const signature=JSON.stringify(receipt.itemIds);
  if(receipt.itemCount>0&&seen.has(signature))throw Error('REPEATED_PROVIDER_PAGE_'+(slug||'catalogue'));
  seen.add(signature);
  for(let batchIndex=0;batchIndex<receipt.batches;batchIndex++)await call({operation:'consume',receiptId,batchIndex});
  const reconciled=await call({operation:'reconcile',receiptId});
  pages.push(reconciled);
  if(receipt.nextOffset===null)return pages;
  if(receipt.nextOffset<=offset)throw Error('NONADVANCING_PROVIDER_CURSOR');
  offset=receipt.nextOffset;
 }
 throw Error('PAGE_SAFETY_CEILING_REACHED_'+(slug||'catalogue'));
}
const catalogue=await traverse('catalogue'),leagues=new Map();
for(const page of catalogue)for(const league of page.leagues||[])if(league.sport)leagues.set(league.slug,league);
const results=[],errors=[];
for(const league of leagues.values()){
 try{const pages=await traverse('events',league.slug,league.sport);results.push({league:league.slug,sport:league.sport,pages:pages.length,events:pages.reduce((s,p)=>s+p.itemCount,0),observations:pages.reduce((s,p)=>s+p.persistedRows,0),complete:true});}
 catch(error){errors.push({league:league.slug,sport:league.sport,error:error.message});}
}
const summary={ok:errors.length===0,run,catalogueComplete:true,listedLeagueCount:leagues.size,results,errors,
 availablePublicLeaguePagesComplete:errors.length===0,fullProviderEntitlementCoverageVerified:false,providerSnapshotAtomic:false,
 readOnly:true,canAuthorizeWager:false};
await writeFile('artifacts/polymarket-us-complete.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
if(errors.length)process.exitCode=1;
