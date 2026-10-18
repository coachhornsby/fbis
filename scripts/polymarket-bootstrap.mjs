import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.BASE||'https://fbis-myz.pages.dev',secret=process.env.HARVEST_SECRET;
if(!secret)throw Error('OPERATOR_SECRET_REQUIRED');
const run=`bootstrap-${process.env.GITHUB_RUN_ID||Date.now()}-${process.env.GITHUB_RUN_ATTEMPT||1}`;
await mkdir('artifacts',{recursive:true});
async function call(body){const response=await fetch(base+'/api/polymarket-bootstrap',{method:'POST',headers:{'content-type':'application/json','x-harvest-secret':secret},body:JSON.stringify(body),signal:AbortSignal.timeout(110000)});const result=await response.json();if(!response.ok&&!result.errors)throw Error('BOOTSTRAP_HTTP_'+response.status+'_'+(result.error||'UNAVAILABLE'));return result;}
const catalogue=await call({operation:'catalogue'}),results=[],discoveryErrors=[];
let rateLimited=false;
for(const league of catalogue.leagues||[]){const seen=new Set();
 try{
 for(let offset=0;offset<60;offset+=20){
  const receiptId=`${run}-${league.slug}-${offset}`;
  const page=await call({operation:'page',...league,offset,receiptId});
  const signature=JSON.stringify(page.itemIds);if(page.itemCount&&seen.has(signature))throw Error('REPEATED_PROVIDER_PAGE');seen.add(signature);
  const quotes=[];for(let batchIndex=0;batchIndex<(page.bookBatches||0);batchIndex++){
   const result=await call({operation:'quotes',receiptId,batchIndex});quotes.push(result);if(result.errors?.some(e=>e.reason.includes('429')))throw Error('PROVIDER_RATE_LIMITED');
  }
  results.push({...page,quotes});
  await writeFile('artifacts/polymarket-bootstrap.json',JSON.stringify({run,catalogue,results,coverageComplete:false,canAuthorizeWager:false},null,2));
  if(page.nextOffset===null||!page.itemCount)break;
 }
 }catch(error){discoveryErrors.push({league:league.slug,reason:error.message});console.log(JSON.stringify(discoveryErrors.at(-1)));if(error.message.includes('429')||error.message==='PROVIDER_RATE_LIMITED'){rateLimited=true;break;}}
}
const summary={run,projectedFixtures:catalogue.projectedFixtures,leagues:catalogue.leagues?.length,pages:results.length,contracts:results.reduce((n,x)=>n+(x.contracts||0),0),quotes:results.reduce((n,x)=>n+x.quotes.reduce((m,y)=>m+y.inserted,0),0),errors:[...discoveryErrors,...results.flatMap(x=>x.quotes.flatMap(y=>y.errors))],rateLimited,coverageComplete:false,canAuthorizeWager:false};
await writeFile('artifacts/polymarket-bootstrap-summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
const r=await fetch(base+'/api/polymarket-stream-start',{method:'POST',headers:{'x-harvest-secret':secret},signal:AbortSignal.timeout(55000)});
const status=await r.json();await writeFile('artifacts/polymarket-stream-start.json',JSON.stringify(status,null,2));
console.log(JSON.stringify({connected:status.connected,subscriptions:status.subscriptions,lastError:status.lastError}));
if(!r.ok||!status.connected||summary.errors.length)process.exitCode=1;
