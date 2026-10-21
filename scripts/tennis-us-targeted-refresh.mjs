import {mkdir,writeFile} from "node:fs/promises";

const base=process.env.BASE||"https://fbis-myz.pages.dev";
const secret=process.env.HARVEST_SECRET;
if(!secret)throw Error("HARVEST_SECRET_REQUIRED");
const run="tennis-targeted-"+(process.env.GITHUB_RUN_ID||Date.now())+"-"+(process.env.GITHUB_RUN_ATTEMPT||1);
const startedAt=new Date().toISOString();
const report={run,startedAt,status:"STARTING",projectedFixtures:0,
 leagues:0,visitedPages:0,matchedEvents:0,contracts:0,bookBatches:0,
 quotesInserted:0,errors:[],canAuthorizeWager:false};
await mkdir("artifacts",{recursive:true});
async function post(body){
 const response=await fetch(base+"/api/polymarket-bootstrap",{
  method:"POST",headers:{"content-type":"application/json","x-harvest-secret":secret},
  body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
 let value;
 try{value=await response.json()}catch{throw Error("NON_JSON_HTTP_"+response.status);}
 if(!response.ok)throw Error("BOOTSTRAP_HTTP_"+response.status+"_"+String(value.error||value.code||"UNAVAILABLE"));
 return value;
}
const receipt=(id,offset)=>run+"-"+String(id).replace(/[^a-z0-9_-]/gi,"-")+"-"+offset;
async function quotes(page){
 if(Array.isArray(page.cachedQuotes)&&page.cachedQuotes.length){
  for(const batch of page.cachedQuotes){
   report.quotesInserted+=Number(batch.inserted||0);
   if(!batch.ok)report.errors.push(...(batch.errors||[]).map(e=>({code:"BOOK_ERROR",reason:e.reason})));
  }
  return;
 }
 for(let i=0;i<Math.min(100,Number(page.bookBatches||0));i++){
  const result=await post({operation:"quotes",receiptId:page.receiptId,batchIndex:i});
  report.bookBatches++;
  report.quotesInserted+=Number(result.inserted||0);
  if(!result.ok)report.errors.push(...(result.errors||[]).map(e=>({code:"BOOK_ERROR",reason:e.reason})));
 }
 if(Number(page.bookBatches||0)>100)report.errors.push({code:"BOOK_BUDGET_EXCEEDED"});
}
async function markets(parent,ref){
 let offset=0;
 for(let i=0;i<25;i++){
  const page=await post({operation:"markets",parentReceiptId:parent.receiptId,
   eventIndex:ref.eventIndex,offset,receiptId:receipt("markets-"+ref.eventId,offset)});
  report.visitedPages++;
  report.contracts+=Number(page.contracts||0);
  await quotes(page);
  if(page.nextOffset==null)return;
  if(page.nextOffset<=offset)throw Error("NON_ADVANCING_MARKET_CURSOR");
  offset=page.nextOffset;
 }
 throw Error("TENNIS_MARKET_PAGINATION_LIMIT");
}
try{
 const catalogues=[];let offset=0;
 for(let i=0;i<14;i++){
  const catalogue=await post({operation:"catalogue",offset});
  for(const fixture of catalogue.fixtures||[])if(fixture.sport==="tennis"){
   if(!catalogues.some(x=>x.id===fixture.id))catalogues.push(fixture);}
  report.leagues+=(catalogue.leagues||[]).filter(l=>l.sport==="tennis").length;
  const leagues=(catalogue.leagues||[]).filter(l=>l.sport==="tennis");
  if(!report.tennisLeagues)report.tennisLeagues=[];
  for(const l of leagues)if(!report.tennisLeagues.some(x=>x.slug===l.slug))report.tennisLeagues.push(l);
  if(catalogue.nextOffset==null)break;
  if(catalogue.nextOffset<=offset)throw Error("NON_ADVANCING_CATALOGUE_CURSOR");
  offset=catalogue.nextOffset;
  if(i===13)throw Error("TENNIS_CATALOGUE_PAGINATION_LIMIT");
 }
 report.projectedFixtures=catalogues.length;
 if(catalogues.length){
  const expanded=new Set();
  for(const league of report.tennisLeagues||[]){
   let nextOffset=0;
   for(let i=0;i<16;i++){
    const page=await post({operation:"page",sport:"tennis",slug:league.slug,
     name:league.name,providerSport:league.providerSport,offset:nextOffset,
     receiptId:receipt(league.slug,nextOffset)});
    report.visitedPages++;
    for(const ref of page.matchedEventRefs||[]){
     if(expanded.has(ref.eventId))continue;
     expanded.add(ref.eventId);report.matchedEvents++;
     await markets(page,ref);
    }
    if(page.nextOffset==null)break;
    if(page.nextOffset<=nextOffset)throw Error("NON_ADVANCING_TENNIS_CURSOR");
    nextOffset=page.nextOffset;
    if(i===15)throw Error("TENNIS_EVENT_PAGINATION_LIMIT");
   }
  }
 }
 report.status=report.errors.length?"PARTIAL":"COLLECTED";
}catch(error){report.status="ERROR";report.errors.push({code:String(error.message||error).slice(0,180)});}
report.finishedAt=new Date().toISOString();
delete report.tennisLeagues;
await writeFile("artifacts/tennis-us-market-refresh.json",JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(report.errors.length)process.exitCode=1;
