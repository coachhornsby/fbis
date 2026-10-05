import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { syncNflTeamProfile } from "../lib/nflTeamProfiles.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},
  });
}
function teamsFrom(url){
  const raw=url.searchParams.get("teams")||url.searchParams.get("team")||"";
  return [...new Set(raw.split(",").map(x=>x.trim().toUpperCase()).filter(Boolean))].slice(0,4);
}

export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  const url=new URL(context.request.url);
  const teams=teamsFrom(url);
  if(!teams.length)return json({ok:false,error:"team-or-teams-required"},400);
  if(!context.env?.DB?.prepare)return json({ok:false,error:"database-unavailable"},503);

  // Bounded batch: maximum four teams per request. Each team uses only a few
  // source calls and writes independently so one slow/failing team cannot
  // invalidate successful profiles in the same batch.
  const results=await Promise.all(teams.map(team=>syncNflTeamProfile({
    DB:context.env.DB,
    ARCHIVE:context.env.ARCHIVE,
    caches:caches.default,
  },team)));
  const failed=results.filter(x=>!x.ok);
  return json({
    ok:failed.length===0,
    status:failed.length===0?"SUCCESS":failed.length===results.length?"FAILED":"PARTIAL",
    teams,
    succeeded:results.length-failed.length,
    failed:failed.length,
    results,
  },failed.length===results.length?502:200);
}
