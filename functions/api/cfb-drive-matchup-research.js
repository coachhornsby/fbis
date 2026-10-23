/** Operator-only read-only CFB matchup drive research. */
import {authorizeHarvest,unauthorizedBody} from "../lib/auth.js";
import {runCfbMatchupResearchFromVerifiedDb} from "../lib/cfbDriveMatchupResearch.js";
const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
 "content-type":"application/json; charset=utf-8","cache-control":"no-store",
 "x-content-type-options":"nosniff"
}});
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return send(unauthorizedBody(auth.reason),403);
 const query=new URL(request.url).searchParams,gameId=query.get("gameId");
 if(!/^[A-Za-z0-9:._-]{1,80}$/.test(String(gameId||"")))
  return send({ok:false,error:"GAME_ID_REQUIRED",canAuthorizeWager:false},400);
 try{
  const result=await runCfbMatchupResearchFromVerifiedDb(env,{gameId,iterations:1000});
  return send(result,result.ok?200:422);
 }catch(e){
  return send({ok:false,error:String(e?.message||"RESEARCH_NOT_AVAILABLE").slice(0,120),
   canAuthorizeWager:false},503);
 }
}
