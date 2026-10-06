import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { buildControlledPregameSample,pregameQualityReport,controlledWalkForwardRows } from "../lib/asianBaseballPregame.js";
import { compareWalkForward } from "../lib/asianBaseballBacktest.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}

export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  let body={};try{body=await context.request.json();}catch{return json({ok:false,error:"invalid-json"},400);}
  const out=await buildControlledPregameSample(context.env,{
    league:String(body.league||"").toUpperCase(),season:Number(body.season||2025),month:Number(body.month||9),
    limit:Number(body.limit||12),cutoffMinutes:Number(body.cutoffMinutes||360)
  });
  return json(out,out.ok?200:400);
}

export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  const u=new URL(context.request.url),league=String(u.searchParams.get("league")||"").toUpperCase();
  const season=Number(u.searchParams.get("season")||2025),month=Number(u.searchParams.get("month")||9);
  if(!league)return json({ok:false,error:"league-required"},400);
  const quality=await pregameQualityReport(context.env,{league,season,month});
  if(u.searchParams.get("walkforward")==="1"){
    const rows=await controlledWalkForwardRows(context.env,{league,season,month});
    return json({ok:true,quality,rows:rows.length,evaluation:compareWalkForward(rows,{minimumN:500}),
      note:"Controlled Phase 3 sample only; never sufficient by itself for promotion."});
  }
  return json(quality);
}
