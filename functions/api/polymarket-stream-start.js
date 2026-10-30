import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost({env,request}){
 const auth=authorizeHarvest(request,env);if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 return json({ok:false,error:'LEGACY_MANUAL_STREAM_START_RETIRED',replacement:'budgeted cron owner',noProviderRequest:true,canAuthorizeWager:false},410);
}
