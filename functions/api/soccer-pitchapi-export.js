import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(),401);
  const u=new URL(context.request.url),league=String(u.searchParams.get("league")||""),before=String(u.searchParams.get("before")||"9999-12-31"),start=String(u.searchParams.get("start")||"2021-01-01");
  const limit=Math.max(1,Math.min(5000,Number(u.searchParams.get("limit"))||5000));
  if(!league||!context.env?.DB?.prepare)return json({ok:false,error:!league?"league-required":"d1-unbound"},400);
  const r=await context.env.DB.prepare(`SELECT * FROM soccer_pitchapi_match_features
    WHERE league_key=? AND match_date>=? AND match_date<? AND status='finished'
    ORDER BY match_date,pitch_match_id LIMIT ?`).bind(league,start,before,limit).all();
  return json({ok:true,league,start,before,count:r?.results?.length||0,rows:r?.results||[],source:"PitchAPI",marketUsed:false});
}
