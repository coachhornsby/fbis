import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost({env,request}){
 const auth=authorizeHarvest(request,env);if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 return json({ok:false,error:'LEGACY_US_COLLECTION_RETIRED',replacement:'fbis-polymarket-rest-collector',noProviderRequest:true,canAuthorizeWager:false},410);
}
export async function onRequestGet(){return json({ok:false,error:'method-not-allowed'},405);}
