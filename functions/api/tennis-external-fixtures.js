import {authorizeHarvest,unauthorizedBody} from "../lib/auth.js";
import {captureEspnTennisSchedule} from "../lib/tennisExternalSchedule.js";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
export async function onRequestPost({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env.DB||!env.ARCHIVE)return json({ok:false,error:"DURABLE_STORAGE_REQUIRED"},503);
 const input=await request.json().catch(()=>({}));
 try{const result=await captureEspnTennisSchedule(env,{tour:input.tour,date:input.date});return json(result)}
 catch(error){return json({ok:false,source:"ESPN_PUBLIC",error:String(error?.message||error).slice(0,150),
  researchOnly:true,canQualify:false,canAuthorizeWager:false},502)}
}
export async function onRequestGet(){return json({ok:false,error:"method-not-allowed"},405)}
