import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {storeSdvNbaHistoryShadow,readSdvNbaShadowStatus} from '../lib/nbaSdvHistoryShadow.js';
const json=(b,status=200)=>Response.json(b,{status,headers:{'cache-control':'no-store','x-robots-tag':'noindex'}});
export async function onRequestPost({env,request}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 const length=Number(request.headers.get('content-length')||0);
 if(length>2500000)return json({ok:false,code:'SDV_PAYLOAD_TOO_LARGE'},413);
 let body;
 try{const content=await request.text();if(content.length>2500000)return json({ok:false,code:'SDV_PAYLOAD_TOO_LARGE'},413);
  body=JSON.parse(content);
 }catch{return json({ok:false,code:'SDV_PAYLOAD_INVALID'},400)}
 const status=await storeSdvNbaHistoryShadow(env,body);
 return json(status,status.ok?200:503);
}
export async function onRequestGet({env}){
 const status=await readSdvNbaShadowStatus(env);
 // Public status exposes aggregate coverage, not private raw boxscore payloads.
 return json({ok:true,...status,mode:'SHADOW_RESEARCH_ONLY',rightsGate:'UNCHANGED'});
}
