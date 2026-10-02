import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { runContinuousLearning, CONTINUOUS_LEARNING_POLICY } from "../lib/continuousLearning.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
    },
  });
}

export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok) return json(unauthorizedBody(),401);
  if(!context.env?.DB?.prepare) return json({ok:false,error:"d1-unbound"},503);

  const url=new URL(context.request.url);
  const sport=String(url.searchParams.get("sport")||"").toLowerCase();
  const supported=["mlb","nfl","cfb","cbb","nba","wnba","nhl","soccer"];
  if(!supported.includes(sport)){
    return json({ok:false,error:"unsupported-sport",supportedSports:supported},400);
  }

  const recentN=Math.max(30,Math.min(250,Number(url.searchParams.get("recentN")||CONTINUOUS_LEARNING_POLICY.recentWindowN)));
  try{
    const out=await runContinuousLearning({DB:context.env.DB},{sport,recentN});
    return json(out,out.ok?200:503);
  }catch(err){
    return json({ok:false,status:"failed",sport,error:String(err?.message||err)},502);
  }
}
