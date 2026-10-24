import fs from 'node:fs/promises';
import {buildRetrospectiveKRows,buildRetrospectiveHitterRows,fitRetrospectiveKCandidate} from '../functions/lib/mlbRetrospectiveKFit.js';
if(!process.env.HARVEST_SECRET)throw Error('HARVEST_SECRET_REQUIRED');
const out='artifacts/mlb-retrospective-k';await fs.mkdir(out,{recursive:true});
const endpoint='https://fbis-myz.pages.dev/api/mlb-completion';
async function post(body){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-harvest-secret':process.env.HARVEST_SECRET},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)}),b=await r.json();if(!r.ok||!b.ok)throw Error(b.error||'READ_FAILED');return b;}
const days=[],missing=[],through=new Date().toISOString().slice(0,10);
for(let t=Date.parse('2024-03-01');t<Date.parse(through);t+=86400000){const date=new Date(t).toISOString().slice(0,10),month=Number(date.slice(5,7));if(month<3||month>11)continue;
 try{days.push(await post({operation:'training-day',date}));}catch(e){missing.push({date,error:e.message});}
 if(days.length%20===0)await fs.writeFile(out+'/coverage.json',JSON.stringify({days:days.length,missing},null,2));
}
const design=buildRetrospectiveKRows(days),report=missing.length?{status:'INCOMPLETE_CORPUS',canPromote:false,missing}:fitRetrospectiveKCandidate(design.rows);
const hitterRows=buildRetrospectiveHitterRows(days),hitterModels=missing.length?{}:Object.fromEntries(Object.entries(hitterRows).map(([market,rows])=>[market,fitRetrospectiveKCandidate(rows,{market,features:['xwobacon','hardHit','barrel','contact','chase','opponentK']})]));
const result={...report,hitterModels,status:missing.length?'INCOMPLETE_CORPUS':'RETROSPECTIVE_MULTI_MARKET',pitcherKStatus:report.status,coverage:{...design.coverage,acquiredDays:days.length,missing},createdAt:new Date().toISOString()};
await fs.writeFile(out+'/report.json',JSON.stringify(result,null,2));await fs.writeFile(out+'/design-rows.json',JSON.stringify({pitcherK:design.rows,...hitterRows}));
console.log(JSON.stringify(await post({operation:'research-report',date:through,report:result})));if(missing.length)process.exitCode=1;
