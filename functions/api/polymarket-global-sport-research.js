import {readGlobalSportCatalogPage} from '../lib/polymarketGlobalSportCatalog.js';
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
export async function onRequestGet({env,request}){
 const u=new URL(request.url);
 const pageRaw=u.searchParams.get('page')||'0';
 if(!/^\d{1,4}$/.test(pageRaw))return json({ok:false,error:'INVALID_PAGE'},400);
 try{
  const r=await readGlobalSportCatalogPage(env,{sport:u.searchParams.get('sport'),
   day:u.searchParams.get('day'),page:Number(pageRaw)});
  return json(r,r.ok?200:400);
 }catch{return json({ok:false,error:'GLOBAL_CATALOG_READ_UNAVAILABLE'},503);}
}
