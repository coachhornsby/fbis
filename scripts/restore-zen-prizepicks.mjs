import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.BASE||'https://fbis-myz.pages.dev',secret=process.env.HARVEST_SECRET;
if(!secret)throw Error('OPERATOR_AUTH_REQUIRED');
const headers={'content-type':'application/json','x-harvest-secret':secret};
await mkdir('artifacts',{recursive:true});
async function api(path,body){const r=await fetch(base+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers,signal:AbortSignal.timeout(180000)});const x=await r.json();if(!r.ok||x.ok===false||x.error)throw Error(JSON.stringify({path,http:r.status,...x}));return x;}
const reauthorized=await api('/api/prizepicks-reauthorize',{operation:'reauthorize_prizepicks'});console.log(JSON.stringify(reauthorized));
const today=await api('/api/prizepicks-props?mode=acquisition');
if(today.acquisition?.state==='COMPLETE'){console.log(JSON.stringify({status:'EXISTING_COMPLETE_DAILY_CAPTURE',...today}));console.log(JSON.stringify(await api('/api/nfl-prop-enrich?date='+today.ctDate,{})));process.exit(0);}
const runId=today.acquisition?.run_id||'zen-pp-'+today.ctDate;
if(!today.acquisition)await api('/api/prizepicks-props',{operation:'reserve',runId});
// One durable acquisition owner starts at most one paid run. Never retry an ambiguous launch.
let started=await api('/api/apify-acquire',{source:'prizepicks'});
const actorRunId=started.data?.id;if(!actorRunId)throw Error('PROVIDER_RUN_ID_REQUIRED');
for(let attempt=0;attempt<36;attempt++){
 try{await api('/api/apify-acquire',{operation:'capture',run:{id:actorRunId}});break;}
 catch(error){if(!error.message.includes('CAPTURE_NOT_COMPLETE')||attempt===35)throw error;await new Promise(r=>setTimeout(r,5000));}
}
const response=await fetch(base+'/api/today?sport=nfl',{signal:AbortSignal.timeout(180000)});const board=await response.json();
const candidates=(board.games||[]).flatMap(g=>(g.playerProjectionRows||[]).map(p=>({...p,eventId:String(g.id),start:g.start,home:g.home?.abbr,away:g.away?.abbr,modelSource:p.source||p.modelSource,modelVersion:p.modelVersion||g.modelVersion})));
let offset=0,total=0,acquisitionId;
while(true){const page=await api('/api/apify-acquire?operation=rows&offset='+offset);total=page.total;acquisitionId=page.acquisitionId;
 if(!page.rows.length)break;
 await api('/api/prizepicks-props',{runId,acquisitionId,batchIndex:offset/200,rows:page.rows,candidates});
 offset+=200;if(offset>=total)break;
}
await api('/api/prizepicks-props',{operation:'complete_capture',runId,acquisitionId});
// Enrichment must follow completion, so readers never pair an unfinished capture.
const enrichment=await api('/api/nfl-prop-enrich?date='+today.ctDate,{});
console.log(JSON.stringify({enrichment}));
const health=await api('/api/prizepicks-props?mode=ingestion_health');
await writeFile('artifacts/zen-prizepicks-restoration.json',JSON.stringify({runId,actorRunId,total,candidates:candidates.length,health},null,2));
console.log(JSON.stringify({runId,actorRunId,total,candidates:candidates.length,health}));
if(!health.healthy)process.exitCode=1;
