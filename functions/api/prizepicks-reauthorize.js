import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
/** Retired provider policy: never reauthorize paid PrizePicks collection. */
export async function onRequestPost({request,env}){
 if(!authorizeHarvest(request,env).ok)return json(unauthorizedBody(),401);
 return json({ok:false,error:'PRIZEPICKS_EXECUTION_RETIRED_USE_EXCHANGE_PROPS',
   canAuthorizeWager:false},410);
}
