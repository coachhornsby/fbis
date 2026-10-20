import {authorizeHarvest,unauthorizedBody} from "../lib/auth.js";
import {refreshAtpPlayerResearch} from "../lib/tennisAtpRankingsRefresh.js";
export async function onRequestPost({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return Response.json(unauthorizedBody(auth.reason),{status:403});
 try{
  const result=await refreshAtpPlayerResearch(env.DB,env.ARCHIVE);
  return Response.json(result,{headers:{"cache-control":"no-store"}});
 }catch(error){
  // Operational classification only; do not leak account credentials or source bodies.
  const code=["ATP_RANKINGS_DATABASE_UNAVAILABLE","ATP_RANKINGS_SOURCE_INSUFFICIENT"]
   .includes(error?.message)?error.message:"ATP_RANKINGS_REFRESH_FAILED";
  return Response.json({ok:false,code,canAuthorizeWager:false},{status:503});
 }
}
export async function onRequestGet(){
 return Response.json({ok:false,code:"METHOD_NOT_ALLOWED"},{status:405});
}
