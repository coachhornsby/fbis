import fs from 'node:fs/promises';
const receipt=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
if(!receipt.complete||!process.env.HARVEST_SECRET)throw Error('COMPLETE_RECEIPT_AND_SECRET_REQUIRED');
const players=[...new Map(receipt.processed.map(p=>[`${p.playerId}:${p.role}`,p])).values()],results=[];
for(const p of players){
 const response=await fetch('https://fbis-myz.pages.dev/api/mlb-model-features',{method:'POST',headers:{'content-type':'application/json','x-harvest-secret':process.env.HARVEST_SECRET},body:JSON.stringify({playerId:p.playerId,role:p.role}),signal:AbortSignal.timeout(90000)});
 const body=await response.json();results.push({playerId:p.playerId,role:p.role,...body});
 await fs.writeFile('artifacts/mlb-statcast-lab/feature-receipt.json',JSON.stringify(results,null,2));
 if(!response.ok||!body.ok)throw Error(`FEATURE_CAPTURE_FAILED:${p.playerId}:${body.error}`);
}
console.log(JSON.stringify({captured:results.length,complete:true}));
