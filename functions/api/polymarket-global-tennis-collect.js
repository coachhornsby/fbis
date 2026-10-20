import {authorizeHarvest,unauthorizedBody} from "../lib/auth.js";
import {collectPolymarketGlobalTennis} from "../lib/tennisPolymarketGlobal.js";
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
export async function onRequestPost({env,request}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 try{
  const result=await collectPolymarketGlobalTennis(env);
  return json(result,result.ok?200:503);
 }catch{
  return json({ok:false,code:"POLY_GLOBAL_TENNIS_COLLECTION_FAILED",canAuthorizeWager:false},503);
 }
}
export async function onRequestGet(){return json({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
