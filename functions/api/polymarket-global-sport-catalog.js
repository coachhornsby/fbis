import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {getGlobalSportCatalog,captureGlobalSportCatalogPage} from '../lib/polymarketGlobalSportCatalog.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function onRequestGet({request,env}){
 if(!authorizeHarvest(request,env).ok)return json(unauthorizedBody(),403);
 const u=new URL(request.url);
 const result=await getGlobalSportCatalog(env,{sport:u.searchParams.get('sport'),
  day:u.searchParams.get('day')});
 return json(result,result.ok?200:400);
}
export async function onRequestPost({request,env}){
 if(!authorizeHarvest(request,env).ok)return json(unauthorizedBody(),403);
 try{
  const input=await request.json();
  const result=await captureGlobalSportCatalogPage(env,input);
  return json(result,result.ok?200:409);
 }catch{return json({ok:false,error:'POLYMARKET_GLOBAL_CATALOG_CAPTURE_FAILED'},503);}
}
