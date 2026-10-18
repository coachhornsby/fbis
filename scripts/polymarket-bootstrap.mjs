import {mkdir,writeFile} from 'node:fs/promises';
import {reconcilePolymarketCoverage} from '../functions/lib/polymarketCoverage.js';
const base=process.env.BASE||'https://fbis-myz.pages.dev',secret=process.env.HARVEST_SECRET;
if(!secret)throw Error('OPERATOR_SECRET_REQUIRED');
// Unique run receipts preserve original evidence; each page is replay-safe within the run.
const newRun=`bootstrap-${process.env.GITHUB_RUN_ID||Date.now()}-${process.env.GITHUB_RUN_ATTEMPT||1}`;
await mkdir('artifacts',{recursive:true});
async function call(body){const response=await fetch(base+'/api/polymarket-bootstrap',{method:'POST',headers:{'content-type':'application/json','x-harvest-secret':secret},body:JSON.stringify(body),signal:AbortSignal.timeout(110000)});let result;
 try{result=await response.json();}catch{throw Error('BOOTSTRAP_NON_JSON_HTTP_'+response.status);}
 if(!response.ok&&!result.errors)throw Error('BOOTSTRAP_HTTP_'+response.status+'_'+(result.error||'UNAVAILABLE'));return result;}
const checkpoint=await call({operation:'resume'}),run=checkpoint.run||newRun,runStartedAt=checkpoint.run?checkpoint.runStartedAt:new Date().toISOString();
const pages=[],errors=[],fixtures=new Map(),leagues=new Map();let discoveryComplete=true,rateLimited=false;
await call({operation:'report',report:{run,runStartedAt,status:'IN_PROGRESS',checkedAt:new Date().toISOString(),coverageComplete:false}});
async function collectPage(body){const page=await call(body),cached=page.cachedQuotes;delete page.cachedQuotes;page.quotes=cached||[];pages.push(page);
 for(let batchIndex=0;!cached&&batchIndex<(page.bookBatches||0);batchIndex++){
  const quote=await call({operation:'quotes',receiptId:body.receiptId,batchIndex});page.quotes.push(quote);
  if(!quote.replayed)await new Promise(r=>setTimeout(r,250));
  if(quote.errors?.some(e=>e.reason.includes('429')))throw Error('PROVIDER_RATE_LIMITED');
 }
 await writeFile('artifacts/polymarket-bootstrap.json',JSON.stringify({run,pages,coverageComplete:false},null,2));return page;}
async function traverse(operation,scope,stem,onPage){let offset=0;const seen=new Set();
 while(true){const page=await collectPage({operation,...scope,offset,receiptId:stem+'-'+offset});
  const signature=JSON.stringify(page.itemIds);if(page.itemCount&&seen.has(signature))throw Error('REPEATED_PROVIDER_PAGE');seen.add(signature);
  if(onPage)await onPage(page);
  if(page.nextOffset==null)break;if(page.nextOffset<=offset)throw Error('NON_ADVANCING_PROVIDER_CURSOR');offset=page.nextOffset;
 }}
try{
 const seen=new Set();let offset=0;
 while(true){const catalogue=await call({operation:'catalogue',offset});const signature=JSON.stringify(catalogue.catalogueIds);
  if(catalogue.catalogueIds?.length&&seen.has(signature))throw Error('REPEATED_CATALOGUE_PAGE');seen.add(signature);
  for(const g of catalogue.fixtures||[])fixtures.set(g.id,g);for(const l of catalogue.leagues||[])leagues.set(l.slug,l);
  if(catalogue.nextOffset==null)break;if(catalogue.nextOffset<=offset)throw Error('NON_ADVANCING_CATALOGUE_CURSOR');offset=catalogue.nextOffset;
 }
 const expanded=new Set();
 // Tennis first: sparse official inventory should not wait behind dense team-sport catalogues.
 const orderedLeagues=[...leagues.values()].sort((a,b)=>(a.sport==='tennis'?0:1)-(b.sport==='tennis'?0:1)||String(a.slug).localeCompare(String(b.slug)));
 for(const league of orderedLeagues){
  try{await traverse('page',league,`${run}-${league.slug}`,async page=>{
   for(const ref of page.matchedEventRefs||[]){const key=league.sport+'|'+ref.eventId;if(expanded.has(key))continue;
    try{await traverse('markets',{parentReceiptId:page.receiptId,eventIndex:ref.eventIndex},`${run}-markets-${ref.eventId}`,null);expanded.add(key);}
    catch(error){discoveryComplete=false;errors.push({eventId:ref.eventId,reason:error.message});if(/429|PROVIDER_RATE_LIMITED/.test(error.message))throw error;}
   }
  });}catch(error){discoveryComplete=false;errors.push({league:league.slug,reason:error.message});if(/429|PROVIDER_RATE_LIMITED/.test(error.message)){rateLimited=true;break;}}
 }
}catch(error){discoveryComplete=false;errors.push({reason:error.message});rateLimited=/429|PROVIDER_RATE_LIMITED/.test(error.message);}
for(const page of pages)for(const batch of page.quotes||[])errors.push(...(batch.errors||[]));
let stream={};try{const r=await fetch(base+'/api/polymarket-stream-start',{method:'POST',headers:{'x-harvest-secret':secret},signal:AbortSignal.timeout(125000)});stream=await r.json();if(!r.ok)errors.push({reason:'STREAM_START_HTTP_'+r.status});}catch{errors.push({reason:'STREAM_START_UNAVAILABLE'});}
if(stream.connected){await new Promise(r=>setTimeout(r,2000));try{const r=await fetch('https://fbis-polymarket-us-stream.coachhornsby.workers.dev/health',{signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error();stream=await r.json();if(stream.lastError)errors.push({reason:'STREAM_REPORTED_ERROR',detail:stream.lastSubscriptionError||stream.lastError});}catch{errors.push({reason:'STREAM_HEALTH_UNAVAILABLE'});}}
const coverage=reconcilePolymarketCoverage({fixtures:[...fixtures.values()],pages,discoveryComplete,errors,stream});
const summary={run,runStartedAt,status:coverage.coverageComplete?'COMPLETE':'GAPS',checkedAt:new Date().toISOString(),leagues:leagues.size,pages:pages.length,rateLimited,...coverage};
await writeFile('artifacts/polymarket-bootstrap-summary.json',JSON.stringify(summary,null,2));
await writeFile('artifacts/polymarket-stream-start.json',JSON.stringify(stream,null,2));
await call({operation:'report',report:summary});console.log(JSON.stringify(summary));
console.log(JSON.stringify({connected:stream.connected,subscriptions:stream.subscriptions,uncoveredCount:stream.uncoveredCount,lastError:stream.lastError}));
// A run with gaps stays visibly failed even if the socket connected successfully.
if(!summary.coverageComplete)process.exitCode=1;
