import { writeFile,mkdir } from 'node:fs/promises';
const base=process.env.FBIS_BASE_URL||'https://fbis-myz.pages.dev';
const date=process.argv[2]||new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const sports=(process.argv[3]||'nfl,nba,nhl,mlb,cfb,wnba,cbb,tennis,soccer,npb,kbo').split(',');
const reports=[];
for(const sport of sports){
 try{const response=await fetch(base+'/api/prop-acceptance?'+new URLSearchParams({sport,date}),{signal:AbortSignal.timeout(90000)});if(!response.ok)throw Error('HTTP_'+response.status);reports.push(await response.json());}
 catch(e){reports.push({sport,date,status:'AUDIT_REQUEST_FAILED',error:e.message});}
}
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/prop-acceptance-'+date+'.json',JSON.stringify({date,base,reports},null,2)+'\n');
console.table(reports.map(r=>({sport:r.sport,status:r.status,models:r.counts?.models,ready:r.counts?.displayReady,contracts:r.counts?.contracts,matched:r.counts?.matchedContracts,historyChecked:r.counts?.historyChecked})));
if(reports.some(r=>r.status==='AUDIT_REQUEST_FAILED'||r.ok===false))process.exitCode=1;
