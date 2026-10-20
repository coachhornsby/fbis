import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {capturePolymarketGlobalNba,listGlobalNbaFixtureSlugs} from '../lib/polymarketGlobalNbaProps.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-robots-tag':'noindex'}});
export async function onRequestPost({env,request}) {
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 try{
  const input=await request.json().catch(()=>({}));
  if(input?.mode==='fixtures'){
   const r=await listGlobalNbaFixtureSlugs(env);
   return json(r,r.ok?200:503);
  }
  const supplied=input?.mode==='ingest'&&Array.isArray(input?.events)?input.events:null;
  if(input?.mode==='ingest'&&!supplied)return json({ok:false,code:'RAW_EVENTS_REQUIRED'},400);
  const result=await capturePolymarketGlobalNba(env,{providedEvents:supplied});
  return json(result,result.ok?200:503);
 }
 catch{return json({ok:false,code:'GAMMA_NBA_PROP_CAPTURE_UNAVAILABLE',canAuthorizeWager:false},503)}
}
export async function onRequestGet(){return json({ok:false,code:'POST_REQUIRED'},405)}
