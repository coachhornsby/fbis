import { loadNflTeamProfiles } from "../lib/nflTeamProfiles.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=60","access-control-allow-origin":"*"},
  });
}
export async function onRequestGet(context){
  if(!context.env?.DB?.prepare)return json({ok:false,error:"database-unavailable"},503);
  const url=new URL(context.request.url);
  const teamRaw=url.searchParams.get("team")||"";
  const teams=teamRaw
    ? [...new Set(teamRaw.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean))]
    : (await context.env.DB.prepare("SELECT team_key FROM nfl_team_profiles ORDER BY team_key").all()).results.map(x=>x.team_key);
  const profiles=await loadNflTeamProfiles(context.env.DB,teams);
  return json({
    ok:true,
    teams:Object.values(profiles.teams||{}).length,
    players:Object.values(profiles.players||{}).reduce((n,x)=>n+x.length,0),
    profiles,
  });
}
