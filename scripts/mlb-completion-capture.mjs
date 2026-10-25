import fs from 'node:fs/promises';
if(!process.env.HARVEST_SECRET)throw Error('HARVEST_SECRET_REQUIRED');
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const r=await fetch('https://fbis-myz.pages.dev/api/mlb-completion',{method:'POST',headers:{'content-type':'application/json','x-harvest-secret':process.env.HARVEST_SECRET},body:JSON.stringify({operation:'capture',date}),signal:AbortSignal.timeout(120000)}),body=await r.json();
await fs.mkdir('artifacts/mlb-completion-capture',{recursive:true});await fs.writeFile('artifacts/mlb-completion-capture/receipt.json',JSON.stringify(body,null,2));
if(!r.ok||!body.ok)throw Error(body.error||'CAPTURE_FAILED');
console.log(JSON.stringify({date,frozen:body.frozen,skipped:body.skipped}));
