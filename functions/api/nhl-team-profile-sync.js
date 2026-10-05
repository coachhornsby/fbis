import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { syncNhlTeamProfile } from "../lib/nhlPersistentProfiles.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
export async function onRequestGet(context){
 const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
 const url=new URL(context.request.url),team=String(url.searchParams.get("team")||"").trim().toUpperCase();
 if(!team)return json({ok:false,error:"team-required"},400);
 if(!context.env?.DB?.prepare)return json({ok:false,error:"database-unavailable"},503);
 const result=await syncNhlTeamProfile({DB:context.env.DB},team);
 return json(result,result.ok?200:502);
}
