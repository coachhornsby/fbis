import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {captureTennisFreeGrades,inspectTennisFreeGrades}
 from '../lib/tennisFreeShadowGradingCapture.js';
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env?.TENNIS_DB?.prepare||!env?.DB?.prepare)
  return json({ok:false,reason:'TENNIS_AND_PRIMARY_EVIDENCE_DB_REQUIRED'},503);
 try{return json(await captureTennisFreeGrades(env))}
 catch(e){return json({ok:false,reason:String(e.message||'GRADING_FAILED'),
  researchOnly:true,contractTradingAuthorized:false},503)}
}
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env?.TENNIS_DB?.prepare)
  return json({ok:false,reason:'TENNIS_DB_REQUIRED'},503);
 try{return json(await inspectTennisFreeGrades(env.TENNIS_DB))}
 catch(e){return json({ok:false,reason:String(e.message||'GRADING_AUDIT_FAILED'),
  researchOnly:true,contractTradingAuthorized:false},503)}
}
