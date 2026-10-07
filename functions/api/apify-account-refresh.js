import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
// Account reads + telemetry only. This route cannot enable acquisitions or alter provider limits.
export async function onRequestPost({request,env}){
 if(!authorizeHarvest(request,env).ok)return json(unauthorizedBody(),401);
 if(!env.DB||!env.APIFY_TOKEN)return json({ok:false,state:'UNKNOWN',reason:'ACCOUNT_READ_NOT_CONFIGURED'},503);
 try{
   const r=await fetch('https://api.apify.com/v2/users/me/limits',{headers:{authorization:`Bearer ${env.APIFY_TOKEN}`}});
   if(!r.ok)return json({ok:false,state:'UNKNOWN',reason:'PROVIDER_ACCOUNT_READ_BLOCKED',http:r.status},503);
   const data=(await r.json()).data,usage=data?.current?.monthlyUsageUsd,limit=data?.limits?.maxMonthlyUsageUsd;
   const start=data?.monthlyUsageCycle?.startAt,endMs=Date.parse(data?.monthlyUsageCycle?.endAt||'');
   if(typeof usage!=='number'||!Number.isFinite(usage)||usage<0||!start||!Number.isFinite(endMs)||typeof limit!=='number')return json({ok:false,state:'UNKNOWN',reason:'ACCOUNT_USAGE_SCHEMA_UNKNOWN'},503);
   const at=new Date().toISOString(),end=new Date(endMs+1).toISOString();
   await env.DB.prepare(`UPDATE external_acquisition_account SET period_start=?,period_end=?,provider_usage_usd=?,usage_observed_at=?,state=CASE WHEN ?>=MIN(hard_cap_usd,?) THEN 'BLOCKED' ELSE state END,reason=CASE WHEN ?>=? THEN 'APIFY_USAGE_LIMIT_REACHED' WHEN ?>=hard_cap_usd THEN 'FBIS_ACCOUNT_BUDGET_EXHAUSTED' ELSE reason END WHERE id='apify'`).bind(start,end,usage,at,usage,limit,usage,limit,usage).run();
   const account=await env.DB.prepare("SELECT * FROM external_acquisition_account WHERE id='apify'").first();
   return json({ok:true,account,providerLimitUsd:limit,readOnlyProviderOperation:true,acquisitionsEnabled:account?.state==='ACTIVE',automaticEnable:false});
 }catch{return json({ok:false,state:'UNKNOWN',reason:'ACCOUNT_RECONCILIATION_FAILED'},503);}
}
