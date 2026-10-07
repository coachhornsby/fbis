import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const token=process.env.APIFY_TOKEN;if(!token)throw Error('APIFY_TOKEN required');
const get=async path=>{const r=await fetch('https://api.apify.com/v2/'+path,{headers:{authorization:`Bearer ${token}`}});if(!r.ok)return {http:r.status};const j=await r.json();return j.data??j;};
const report={capturedAt:new Date().toISOString(),readOnly:true,limits:await get('users/me/limits'),usage:await get('users/me/usage/monthly'),schedules:await get('schedules?limit=100'),runs:[],errors:[]};
for(let offset=0;offset<1000;offset+=100){
 const page=await get(`actor-runs?limit=100&offset=${offset}&desc=true`);
 if(!Array.isArray(page?.items)){report.errors.push({stage:'runs',response:page});break;}
 let done=false;
 for(const r of page.items){
   if(r.startedAt<'2026-09-12T00:00:00.000Z'){done=true;continue;}
   const input=r.defaultKeyValueStoreId?await get(`key-value-stores/${r.defaultKeyValueStoreId}/records/INPUT`):null;
   const scope=input?.http?null:Object.fromEntries(['leagues','sport','league','date','season','week','gameStatus','maxGames','maxItems','listLeagues','includeLineMovement','includeProps','includeInjuries','includeStandings'].filter(k=>input?.[k]!==undefined).map(k=>[k,input[k]]));
   const ds=r.defaultDatasetId?await get(`datasets/${r.defaultDatasetId}`):null;
   report.runs.push({id:r.id,actorId:r.actId,taskId:r.actorTaskId||null,status:r.status,startedAt:r.startedAt,finishedAt:r.finishedAt,datasetId:r.defaultDatasetId,returned:ds?.itemCount??null,providerReportedUsageUsd:r.usageTotalUsd??null,pricingInfo:r.pricingInfo||null,origin:r.meta?.origin||null,scope,scopeHash:scope?createHash('sha256').update(JSON.stringify(scope)).digest('hex'):null});
 }
 if(done||page.items.length<100)break;
}
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/apify-account-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({readOnly:true,runs:report.runs.length,costKnown:report.runs.filter(r=>r.providerReportedUsageUsd!=null).length,providerReportedRunUsageUsd:report.runs.reduce((s,r)=>s+(r.providerReportedUsageUsd||0),0),limits:report.limits,usage:report.usage,errors:report.errors},null,2));
