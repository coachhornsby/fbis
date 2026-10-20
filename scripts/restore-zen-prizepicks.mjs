import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {PRIZEPICKS_FBIS_SPORTS} from '../functions/lib/propMarketPolicy.js';

export async function loadPrizePicksCandidates(readBoard, date) {
 const candidates=[], failures=[];
 // Bounded concurrency; source capture must still complete if one model is unavailable.
 for(let offset=0;offset<PRIZEPICKS_FBIS_SPORTS.length;offset+=3){
  const sports=PRIZEPICKS_FBIS_SPORTS.slice(offset,offset+3);
  const results=await Promise.allSettled(sports.map(sport=>readBoard(sport,date)));
  results.forEach((result,i)=>{
   const sport=sports[i];
   if(result.status==='rejected'){failures.push({sport,error:String(result.reason?.message||result.reason)});return;}
   for(const g of result.value.games||[])for(const p of g.playerProjectionRows||[]){
    if(p.fbisProjection==null||!Number.isFinite(Number(p.fbisProjection)))continue;
    candidates.push({...p,sport,eventId:String(g.id),start:g.start,home:g.home?.abbr,away:g.away?.abbr,
     modelSource:p.source||p.modelSource,modelVersion:p.modelVersion||g.modelVersion});
   }
  });
 }
 return {candidates,failures};
}

export async function restorePrizePicks({base=process.env.BASE||'https://fbis-myz.pages.dev',secret=process.env.HARVEST_SECRET}={}) {
 if(!secret)throw Error('OPERATOR_AUTH_REQUIRED');
 const headers={'content-type':'application/json','x-harvest-secret':secret};
 await mkdir('artifacts',{recursive:true});
 async function api(path,body){const r=await fetch(base+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers,signal:AbortSignal.timeout(180000)});const x=await r.json();if(!r.ok||x.ok===false||x.error)throw Error(JSON.stringify({path,http:r.status,...x}));return x;}
 const today=await api('/api/prizepicks-props?mode=acquisition');
 if(today.acquisition?.state==='COMPLETE'){
  // Never relaunch a paid source just because it has no lines for a sport.
  // A completed capture is immutable; missing offers must remain visible.
  const report={status:'EXISTING_COMPLETE_DAILY_CAPTURE',requestedSports:PRIZEPICKS_FBIS_SPORTS,...today};
  await writeFile('artifacts/zen-prizepicks-restoration.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));return report;
 }
 const reauthorized=await api('/api/prizepicks-reauthorize',{operation:'reauthorize_prizepicks'});console.log(JSON.stringify(reauthorized));
 const runId=today.acquisition?.run_id||'zen-pp-'+today.ctDate;
 if(!today.acquisition)await api('/api/prizepicks-props',{operation:'reserve',runId});
 // The durable owner enforces the existing $0.70 launch ceiling, account budget,
 // one-run daily policy and ambiguous-start protection across all eleven sports.
 const started=await api('/api/apify-acquire',{source:'prizepicks'});
 const actorRunId=started.data?.id;if(!actorRunId)throw Error('PROVIDER_RUN_ID_REQUIRED');
 for(let attempt=0;attempt<36;attempt++){
  try{await api('/api/apify-acquire',{operation:'capture',run:{id:actorRunId}});break;}
  catch(error){if(!error.message.includes('CAPTURE_NOT_COMPLETE')||attempt===35)throw error;await new Promise(r=>setTimeout(r,5000));}
 }
 const {candidates,failures}=await loadPrizePicksCandidates((sport,date)=>api('/api/today?sport='+sport+'&date='+date),today.ctDate);
 let offset=0,total=0,acquisitionId;
 while(true){const page=await api('/api/apify-acquire?operation=rows&offset='+offset);total=page.total;acquisitionId=page.acquisitionId;
  if(!page.rows.length)break;
  await api('/api/prizepicks-props',{runId,acquisitionId,batchIndex:offset/200,rows:page.rows,candidates});
  offset+=200;if(offset>=total)break;
 }
 await api('/api/prizepicks-props',{operation:'complete_capture',runId,acquisitionId});
 const enrichment=[];
 for(const sport of ['nfl','tennis','soccer']){
  try{
   for(let attempt=0;attempt<(sport==='nfl'?1:5);attempt++){
    const result=sport==='nfl'?await api('/api/nfl-prop-enrich?date='+today.ctDate,{}):await api('/api/prop-enrich-current',{sport,date:today.ctDate,limit:20});
    enrichment.push({sport,...result});if(!result.remainingHint)break;
   }
  }catch(error){failures.push({sport,error:String(error.message)});}
 }
 const health=await api('/api/prizepicks-props?mode=ingestion_health');
 const coverage=await api('/api/prizepicks-props?mode=acquisition');
 const report={runId,actorRunId,total,requestedSports:PRIZEPICKS_FBIS_SPORTS,candidates:candidates.length,modelFailures:failures,enrichment,health,coverage:coverage.coverage};
 await writeFile('artifacts/zen-prizepicks-restoration.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
 if(!health.healthy||failures.length)process.exitCode=1;
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await restorePrizePicks();
