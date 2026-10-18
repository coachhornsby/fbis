import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {bootstrapPolymarket} from '../lib/polymarketBootstrap.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 if(!authorizeHarvest(request,env).ok)return json(unauthorizedBody(),403);
 try{const body=await request.json();
  if(body.operation!=='catalogue'){
   const probe=await env.DB.prepare('SELECT 1 AS healthy').all();const bytes=Number(probe?.meta?.size_after);
   if(!Number.isFinite(bytes)||bytes<=0||bytes>=9_500_000_000)return json({ok:false,error:'REST_WRITE_CAPACITY_UNAVAILABLE',canAuthorizeWager:false},409);
  }
  const result=await bootstrapPolymarket(env,body);return json(result,result.ok?200:409);
 }
 catch{return json({ok:false,error:'BOOTSTRAP_UNAVAILABLE',canAuthorizeWager:false},503);}
}
