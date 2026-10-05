import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { persistPitchApiBundle } from "../lib/soccerPitchApiStore.js";
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(),401);
  let body={};try{body=await context.request.json();}catch{return json({ok:false,error:"invalid-json"},400);}
  const bundles=Array.isArray(body.bundles)?body.bundles:[body.bundle].filter(Boolean);
  if(!bundles.length||bundles.length>25)return json({ok:false,error:"bundles-required-max-25"},400);
  let matches=0,players=0,lineups=0,failed=0;const errors=[];
  for(const bundle of bundles){
    try{
      const r=await persistPitchApiBundle(context.env,bundle);
      if(!r.ok){failed++;errors.push({id:bundle?.match?.id||null,reason:r.reason||"persist-failed"});continue;}
      matches+=r.match||0;players+=r.players||0;lineups+=r.lineups||0;
    }catch(err){failed++;errors.push({id:bundle?.match?.id||null,reason:String(err?.message||err)});}
  }
  return json({ok:failed===0,matches,players,lineups,failed,errors,source:"PitchAPI",marketUsed:false});
}
