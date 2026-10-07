import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { collectAsianBaseballMarket } from "../lib/asianBaseballMarket.js";
export async function onRequestGet(context){
 const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return new Response(JSON.stringify(unauthorizedBody()),{status:401,headers:{"content-type":"application/json"}});
 const u=new URL(context.request.url),league=String(u.searchParams.get("league")||"").toUpperCase();
 if(!["NPB","KBO"].includes(league))return json({ok:false,error:"league must be NPB or KBO"},400);
 const result=await collectAsianBaseballMarket({env:context.env,league,snapshotType:String(u.searchParams.get("snapshotType")||"CURRENT").toUpperCase()});
 return json(result,result.ok?200:503);
}
function json(v,status=200){return new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
