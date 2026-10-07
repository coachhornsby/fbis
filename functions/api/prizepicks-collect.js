import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
export async function onRequestPost({request,env}){
 if(!authorizeHarvest(request,env).ok)return json(unauthorizedBody(),401);
 return json({ok:false,blocked:true,error:'LEGACY_PRIZEPICKS_COLLECTOR_DISABLED',message:'Use the shared acquisition authority and persisted capture.'},410);
}
