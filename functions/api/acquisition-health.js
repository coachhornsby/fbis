import { billingWindow } from '../lib/externalAcquisition.js';
export async function onRequestGet({env}){
 const headers={'content-type':'application/json','cache-control':'no-store'};
 try{
 const account=await env.DB.prepare("SELECT * FROM external_acquisition_account WHERE id='apify'").first();
 const policies=(await env.DB.prepare('SELECT * FROM external_acquisition_policy').all()).results;
 const metrics=(await env.DB.prepare(`SELECT source,COUNT(*) acquisitions,COUNT(provider_run_id) confirmedLaunches,SUM(provider_cost_usd) providerReportedCostUsd,COUNT(provider_cost_usd) knownCostRuns,SUM(CASE WHEN observations_returned=0 THEN 1 ELSE 0 END) zeroResultRuns,SUM(observations_returned) returnedObservations,SUM(CASE WHEN state='UNKNOWN_START' THEN 1 ELSE 0 END) uncertainStarts,MAX(captured_at) latestCaptureAt FROM external_acquisitions WHERE created_at>=? GROUP BY source`).bind(account?.period_start||billingWindow().start).all()).results;
 const spendByDay=(await env.DB.prepare('SELECT source,substr(created_at,1,10) day,COUNT(*) acquisitions,COUNT(provider_cost_usd) knownCostRuns,SUM(provider_cost_usd) providerReportedCostUsd FROM external_acquisitions GROUP BY source,day ORDER BY day DESC LIMIT 62').all()).results;
 const requests=(await env.DB.prepare('SELECT source,outcome,reason,COUNT(*) requests FROM external_acquisition_requests WHERE created_at>=? GROUP BY source,outcome,reason').bind(account?.period_start||billingWindow().start).all()).results;
 const consumers=(await env.DB.prepare('SELECT a.source,c.sport,c.component,SUM(c.accepted) accepted,SUM(c.duplicates) duplicates,SUM(c.rejected) rejected,MAX(c.consumed_at) lastConsumedAt FROM external_acquisition_consumers c JOIN external_acquisitions a ON a.id=c.acquisition_id GROUP BY a.source,c.sport,c.component').all()).results;
 const sourceStates=policies.map(p=>{
   const m=metrics.find(m=>m.source===p.source),ageMs=m?.latestCaptureAt?Date.now()-Date.parse(m.latestCaptureAt):null;
   const canonicalKnown=consumers.some(c=>c.source===p.source&&c.lastConsumedAt&&Number(c.accepted)>0);
   const state=p.state!=='ACTIVE'||account?.state!=='ACTIVE'?'BLOCKED':ageMs==null?'UNKNOWN':ageMs>p.freshness_seconds*1000?'STALE':!canonicalKnown?'DEGRADED':'HEALTHY';
   return {source:p.source,state,freshnessAgeMs:ageMs,reason:state==='BLOCKED'?account?.reason||p.reason:state==='DEGRADED'?'CANONICAL_CONSUMPTION_NOT_VERIFIED':null};
 });
 const accountAgeMs=Date.now()-Date.parse(account?.usage_observed_at||'');
 const reconciled=Number.isFinite(accountAgeMs)&&accountAgeMs>=0&&accountAgeMs<=3600000;
 const status=account?.state!=='ACTIVE'?'BLOCKED':!reconciled?'DEGRADED':sourceStates.every(s=>s.state==='HEALTHY')?'HEALTHY':'DEGRADED';
 const budgetState=account?.provider_usage_usd==null?"UNKNOWN":account.provider_usage_usd>=account.hard_cap_usd?"STOP":account.provider_usage_usd>=account.target_usd?"THROTTLE":account.provider_usage_usd>=account.target_usd*0.8?"WARNING":"NORMAL";
 return new Response(JSON.stringify({ok:true,status,budgetState,account,policies,sourceStates,metrics,spendByDay,requests,consumers,prospectiveMeasurement:true,historicalCostReconciled:account?.provider_usage_usd!=null,requiresFreshProviderUsage:true,canQualify:false,canAuthorizeWager:false}),{headers});
 }catch{return new Response(JSON.stringify({ok:false,status:'UNKNOWN',reason:'ACQUISITION_HEALTH_UNAVAILABLE',canQualify:false,canAuthorizeWager:false}),{status:503,headers});}
}
