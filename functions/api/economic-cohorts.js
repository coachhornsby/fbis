import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { persistEconomicCohorts } from "../lib/canonical/economicCohorts.js";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export async function onRequestPost(context){
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const auth=authorizeHarvest(context.request,context.env); if(!auth.ok)return json(unauthorizedBody(),401);
  let body={};try{body=await context.request.json()}catch{}
  const out=await persistEconomicCohorts(context.env,{sport:body.sport||null,windowStartAt:body.windowStartAt||null,windowEndAt:body.windowEndAt||null});
  return json(out,out.ok?200:500);
}
