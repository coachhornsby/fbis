import { authorizeHarvest, unauthorizedBody } from '../lib/auth.js';
import { captureOfficialWtaSchedule } from '../lib/tennisOfficialSchedule.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost({request,env}){const auth=authorizeHarvest(request,env);if(!auth.ok)return json(unauthorizedBody(auth.reason),403);try{const r=await captureOfficialWtaSchedule(env);return json(r,r.ok?200:502);}catch(e){return json({ok:false,reason:e.message,researchOnly:true,canAuthorizeWager:false},503);}}
