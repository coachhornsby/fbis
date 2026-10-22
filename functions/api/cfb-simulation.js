import {authorizeStrategyPost} from "../lib/auth.js";
import {freezeCfbShadowEvent,gradeCfbShadowEvent,cfbShadowReport} from "../lib/cfbSimulationStore.js";
import {freezeCfbDriveShadow,gradeCfbDriveShadow,cfbDriveResearchStatus} from "../lib/cfbDriveSimulationStore.js";
import {freezeCfbDriveResearchAsOf} from "../lib/cfbDriveResearchAsOf.js";
import {cfbDriveCohortReport} from "../lib/cfbDriveCohortReport.js";
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{
  "content-type":"application/json; charset=utf-8","cache-control":"no-store",
  "x-content-type-options":"nosniff"
}});
const errorStatus=err=>{
  const e=String(err?.message||err);
  if(/UNBOUND|SCHEMA_NOT_INSTALLED/.test(e))return 503;
  if(/INVALID_|UNSUPPORTED_|INSUFFICIENT_|MISSING_|NOT_FROZEN_/.test(e))return 422;
  return 503;
};
/** Operator-only research. No permissive CORS, public write or secret query args. */
export async function onRequestGet({request,env}){
  if(!authorizeStrategyPost(request,env).ok)return response({ok:false,error:"unauthorized"},401);
  try{if(new URL(request.url).searchParams.get("mode")==="drives")return response(await cfbDriveResearchStatus(env));
    if(new URL(request.url).searchParams.get("mode")==="cohort")return response(await cfbDriveCohortReport(env,{limit:100}));
    return response(await cfbShadowReport(env,{limit:new URL(request.url).searchParams.get("limit")||20}));}
  catch(err){return response({ok:false,error:String(err?.message||err).slice(0,100)},errorStatus(err));}
}
export async function onRequestPost({request,env}){
  if(!authorizeStrategyPost(request,env).ok)return response({ok:false,error:"unauthorized"},401);
  let data;try{data=await request.json();}catch{return response({ok:false,error:"invalid-json"},400);}
  if(!data||typeof data!=="object"||Array.isArray(data))return response({ok:false,error:"invalid-body"},400);
  const action=String(data.action||"");
  if(!["freeze","grade","drive-freeze","drive-grade","drive-research-asof"].includes(action))return response({ok:false,error:"unsupported-action"},400);
  try{
    const result=action==="freeze"
      ? await freezeCfbShadowEvent(env,{gameId:data.gameId,iterations:5000})
      : action==="grade"
      ? await gradeCfbShadowEvent(env,{gameId:data.gameId})
      : action==="drive-freeze"
      ? await freezeCfbDriveShadow(env,{gameId:data.gameId,iterations:1000})
      : action==="drive-research-asof"
      ? await freezeCfbDriveResearchAsOf(env,{gameId:data.gameId,iterations:1000})
      : await gradeCfbDriveShadow(env,{gameId:data.gameId});
    return response(result,result.ok?200:422);
  }catch(err){return response({ok:false,error:String(err?.message||err).slice(0,100)},errorStatus(err));}
}
