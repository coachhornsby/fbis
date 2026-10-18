import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {onRequestPost as refreshAccount} from './apify-account-refresh.js';
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
/** Explicit operator reauthorization after a fresh provider allowance read.
 * Only PrizePicks resumes; provider ceilings and FBIS budgets never increase.
 */
export async function onRequestPost(context){
 if(!authorizeHarvest(context.request,context.env).ok)return json(unauthorizedBody(),401);
 const body=await context.request.json();if(body.operation!=='reauthorize_prizepicks')return json({ok:false,error:'EXPLICIT_REAUTHORIZATION_REQUIRED'},400);
 const refresh=await refreshAccount(context),verified=await refresh.json();
 if(!refresh.ok||!verified.ok||verified.headroomUsd<.70)return json({ok:false,error:'VERIFIED_PROVIDER_HEADROOM_REQUIRED',headroomUsd:verified.headroomUsd??0},409);
 const at=Date.now();if(!(Date.parse(verified.account.period_start)<=at&&at<Date.parse(verified.account.period_end)))return json({ok:false,error:'CURRENT_BILLING_PERIOD_REQUIRED'},409);
 await context.env.DB.prepare("UPDATE external_acquisition_policy SET state='BLOCKED',reason='PRIZEPICKS_ONLY_REAUTHORIZATION' WHERE source='action'").run();
 await context.env.DB.prepare("UPDATE external_acquisition_policy SET state='ACTIVE',reason='OPERATOR_REAUTHORIZED_ZEN_PRIZEPICKS',per_run_cap_usd=MIN(per_run_cap_usd,0.70),daily_cap_usd=MIN(daily_cap_usd,0.70),daily_run_limit=MIN(daily_run_limit,1) WHERE source='prizepicks'").run();
 await context.env.DB.prepare("UPDATE external_acquisition_account SET state='ACTIVE',reason='OPERATOR_REAUTHORIZED_PRIZEPICKS_VERIFIED_ALLOWANCE' WHERE id='apify'").run();
 return json({ok:true,source:'prizepicks',providerLimitUsd:verified.providerLimitUsd,headroomUsd:verified.headroomUsd,maxPullUsd:.70,maxDailyRuns:1,actionEnabled:false,canAuthorizeWager:false});
}
