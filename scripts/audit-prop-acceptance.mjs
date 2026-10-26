import { writeFile,mkdir } from 'node:fs/promises';
const base=process.env.FBIS_BASE_URL||'https://fbis-myz.pages.dev';
const date=process.argv[2]||new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const sports=(process.argv[3]||'nfl,nba,nhl,mlb,cfb,cbb,tennis').split(',');
const active=new Set(['nfl','nba','nhl','mlb','cfb','cbb','tennis']);
if(sports.some(s=>!active.has(s)))throw Error('RETIRED_OR_UNSUPPORTED_SPORT_SCOPE');
const reports=[],captures=[];
// Uses the same existing harvest credential as the approved source-ingest jobs.
// No token or request headers enter the public report or logs.
if(process.env.HARVEST_SECRET)for(const sport of sports.filter(s=>['nba','nfl','nhl','mlb'].includes(s))){
 try{const response=await fetch(base+'/api/prop-acceptance?'+new URLSearchParams({sport}),{method:'POST',headers:{'x-harvest-secret':process.env.HARVEST_SECRET},signal:AbortSignal.timeout(90000)});const body=await response.json();captures.push({sport,http:response.status,status:body.status,forecastCount:body.captured||0,blocked:body.blocked||{},reason:body.reason||body.error||null});}
 catch(e){captures.push({sport,status:'CAPTURE_REQUEST_FAILED',reason:e.message});}
}

for(const sport of sports){
 try{const response=await fetch(base+'/api/prop-acceptance?'+new URLSearchParams({sport,date}),{signal:AbortSignal.timeout(90000)});if(!response.ok)throw Error('HTTP_'+response.status);reports.push(await response.json());}
 catch(e){reports.push({sport,date,status:'AUDIT_REQUEST_FAILED',error:e.message});}
}
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/prop-acceptance-'+date+'.json',JSON.stringify({date,base,captures,reports},null,2)+'\n');
console.table(captures);
console.table(reports.map(r=>({sport:r.sport,status:r.status,models:r.counts?.models,ready:r.counts?.displayReady,contracts:r.counts?.contracts,matched:r.counts?.matchedContracts,historyChecked:r.counts?.historyChecked})));
if(reports.some(r=>r.status==='AUDIT_REQUEST_FAILED'||r.ok===false))process.exitCode=1;
