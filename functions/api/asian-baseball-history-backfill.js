import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { runAsianBaseballHistoricalShard, historicalQualityReport } from "../lib/asianBaseballHistory.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}

export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  let body={};try{body=await context.request.json();}catch{return json({ok:false,error:"invalid-json"},400);}
  const league=String(body.league||"").toUpperCase(),season=Number(body.season),month=Number(body.month),maxRequests=Number(body.maxRequests||7);
  const out=await runAsianBaseballHistoricalShard(context.env,{league,season,month,maxRequests});
  return json(out,out.ok?200:500);
}
export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  const u=new URL(context.request.url);
  const league=String(u.searchParams.get("league")||"").toUpperCase(),season=Number(u.searchParams.get("season")),month=Number(u.searchParams.get("month"));
  if(!league||!season||!month)return json({ok:false,error:"league-season-month-required"},400);
  return json(await historicalQualityReport(context.env,{league,season,month}));
}
