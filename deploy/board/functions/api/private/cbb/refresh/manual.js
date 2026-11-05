// Explicit owner POST only. No public GET or scheduled jobs, no D1, no market source.
import {inspectRequestOwnerAccess} from '../[date].js';
import {refreshCbbOnce} from '../../../../../../../functions/lib/cbbPrivateOperatorRefresh.js';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','vary':'Cookie'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
export async function onRequestPost({request,env}){
 const url=new URL(request.url);
 if(request.headers.get('Origin')!==url.origin||
    request.headers.get('X-FBIS-Manual-Refresh')!=='1'||
    (request.headers.get('Sec-Fetch-Site')&&!['same-origin','none'].includes(request.headers.get('Sec-Fetch-Site'))))
  return json({state:'ORIGIN_OR_ACTION_NOT_VERIFIED'},403);
 const auth=await inspectRequestOwnerAccess(request,env);
 if(!auth.ok)return json({state:'PRIVATE_AUTH_REQUIRED',authStage:auth.reason},401);
 if(!env?.FBIS_PRIVATE_CBB)return json({state:'PRIVATE_STORAGE_UNAVAILABLE'},503);
 let payload;
 try{payload=await request.json();}catch{return json({state:'INVALID_REQUEST'},400);}
 if(!payload||Object.keys(payload).some(k=>k!=='date')||typeof payload.date!=='string')return json({state:'INVALID_REQUEST'},400);
 try{
  const result=await refreshCbbOnce({bucket:env.FBIS_PRIVATE_CBB,date:payload.date,key:String(env.KENPOM_API_KEY||'').trim(),assets:env.ASSETS||null});
  const {status,...body}=result;return json(body,status);
 }catch{return json({state:'CBB_REFRESH_UNAVAILABLE'},503);}
}
export async function onRequest(){return json({state:'METHOD_NOT_ALLOWED'},405);}
