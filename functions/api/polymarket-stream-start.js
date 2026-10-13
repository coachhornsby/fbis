import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost({env,request}){
 const auth=authorizeHarvest(request,env);if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env.POLYMARKET_STREAM_PROXY_TOKEN)return json({ok:false,error:'STREAM_LINK_UNCONFIGURED'},503);
 try{return await fetch('https://fbis-polymarket-us-stream.coachhornsby.workers.dev/start',{method:'POST',headers:{'x-fbis-stream-token':env.POLYMARKET_STREAM_PROXY_TOKEN},signal:AbortSignal.timeout(45000)});}
 catch{return json({ok:false,error:'STREAM_START_UNAVAILABLE'},502);}
}
