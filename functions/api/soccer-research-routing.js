import { authorizeSoccerWorker, unauthorizedBody } from "../lib/soccerWorkerAuth.js";
import {
  buildSoccerRoutingRegistryReport,
  resolveSoccerResearchRoute,
} from "../lib/soccerResearchRouting.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},
  });
}

export async function onRequestGet(context){
  const auth=authorizeSoccerWorker(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);

  const url=new URL(context.request.url);
  const competition=url.searchParams.get("competition");
  const marketFamily=url.searchParams.get("marketFamily");
  if(!competition&&!marketFamily)return json({ok:true,...buildSoccerRoutingRegistryReport()});
  if(!competition||!marketFamily)return json({ok:false,error:"competition-and-market-family-required"},400);

  const resolved=resolveSoccerResearchRoute({
    competition,
    marketFamily,
    evidenceSnapshot:url.searchParams.get("evidenceSnapshot"),
    evidenceCodeSha:url.searchParams.get("evidenceCodeSha"),
  });
  return json({ok:true,resolved});
}
