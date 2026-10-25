import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {captureTennisFreeShadow} from '../lib/tennisFreeShadowCapture.js';
import {FREE_TENNIS_SHADOW_VERSION} from '../lib/tennisFreeShadowModel.js';
const json=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env?.TENNIS_DB?.prepare)return json({ok:false,reason:'TENNIS_DB_UNBOUND'},503);
 const u=new URL(request.url);
 try{
  if(u.searchParams.get('dry_run')==='true')
   return json(await captureTennisFreeShadow(env,{write:false}));
  const rows=(await env.TENNIS_DB.prepare(`SELECT tour,COUNT(*) n,
   MAX(forecast_at) last_forecast FROM tennis_free_shadow_forecasts
   WHERE model_id=? GROUP BY tour ORDER BY tour`)
   .bind(FREE_TENNIS_SHADOW_VERSION).all()).results||[];
  return json({ok:true,modelId:FREE_TENNIS_SHADOW_VERSION,counts:rows,
   researchOnly:true,calibrated:false,contractTradingAuthorized:false});
 }catch(e){return json({ok:false,reason:String(e?.message||'SHADOW_INSPECTION_UNAVAILABLE'),
  contractTradingAuthorized:false},503)}
}
export async function onRequestPost({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 try{return json(await captureTennisFreeShadow(env,{write:true}));}
 catch(e){return json({ok:false,reason:String(e?.message||'SHADOW_CAPTURE_UNAVAILABLE'),
  contractTradingAuthorized:false},503)}
}
