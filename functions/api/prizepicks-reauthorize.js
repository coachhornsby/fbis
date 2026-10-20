import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost(context){
 if(!authorizeHarvest(context.request,context.env).ok)return json(unauthorizedBody(),401);
 return json({ok:false,error:'PRIZEPICKS_EXECUTION_RETIRED_USE_EXCHANGE_PROPS'},410);
}
