import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";

const respond=(body,status=200)=>new Response(JSON.stringify(body),
  {status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
/**
 * Private read-only research endpoint for current, persisted CBBD CBB profiles.
 * Reads D1 exclusively: page views and profile requests never call CBBD.
 */
export async function onRequestGet({request,env}) {
  const auth=authorizeHarvest(request,env);
  if(!auth.ok)return respond(unauthorizedBody(),401);
  if(!env?.DB?.prepare)return respond({ok:false,error:"D1_UNBOUND"},503);
  const url=new URL(request.url);
  const teamId=String(url.searchParams.get("teamId")||"");
  const season=Number(url.searchParams.get("season")||"0");
  if(!/^[a-z0-9:-]{3,80}$/i.test(teamId)||!Number.isInteger(season)||season<2000||season>2100)
    return respond({ok:false,error:"teamId-and-ending-season-required"},400);
  try {
    const record=await env.DB.prepare(`SELECT snapshot_id,canonical_team_id,season,observed_at,profile_version,
      profile_json FROM cbb_team_profile_snapshots
      WHERE canonical_team_id=? AND season=?
      ORDER BY observed_at DESC LIMIT 1`).bind(teamId,season).first();
    if(!record)return respond({ok:false,error:"profile-unavailable",networkCalls:0},404);
    return respond({ok:true,mode:"RESEARCH",networkCalls:0,
      canInfluenceProjection:false,canQualify:false,canAuthorizeWager:false,
      snapshotId:record.snapshot_id,teamId:record.canonical_team_id,season:record.season,
      observedAt:record.observed_at,profileVersion:record.profile_version,
      profile:JSON.parse(record.profile_json)});
  } catch {
    return respond({ok:false,error:"profile-store-unavailable",networkCalls:0},503);
  }
}
