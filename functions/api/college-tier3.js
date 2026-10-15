import {parseCfbTier3WeeklyCsv,saveCfbTier3WeeklySnapshot} from "../lib/cfbTier3Weekly.js";

// Only the existing harvest operator can upload licensed data. Header only:
// never put a secret, original rows, or a private R2 location in a URL.
function isAuthorized(request,env) {
  const secret=env?.HARVEST_SECRET;
  return Boolean(secret && request.headers.get("x-harvest-secret")===secret);
}
const respond=(payload,status=200)=>new Response(JSON.stringify(payload),
  {status,headers:{"content-type":"application/json","cache-control":"no-store"}});
export async function onRequestPost({request,env}) {
  if(!isAuthorized(request,env))return respond({ok:false,error:"unauthorized"},401);
  if(!env?.TIER3_DB?.batch||!env?.ARCHIVE?.put)
    return respond({ok:false,error:"private-storage-not-configured"},503);
  const type=request.headers.get("content-type")||"";
  if(!type.toLowerCase().startsWith("text/csv"))
    return respond({ok:false,error:"text-csv-required"},415);
  const declared=Number(request.headers.get("content-length")||"0");
  if(declared>2_000_000)return respond({ok:false,error:"csv-too-large"},413);
  try {
    const raw=await request.text();
    const filename=request.headers.get("x-source-filename")||"training_data.csv";
    const snapshot=await parseCfbTier3WeeklyCsv(raw,{filename});
    const result=await saveCfbTier3WeeklySnapshot(env,snapshot,raw);
    return respond(result,result.ok?200:503);
  } catch(e) {
    const reason=String(e?.message||e);
    return respond({ok:false,error:reason.startsWith("TIER3_")?reason:"tier3-ingestion-failed",
      networkCalls:0,canAuthorizeWager:false},reason.startsWith("TIER3_")?422:500);
  }
}
export async function onRequestGet({request,env}) {
  if(!isAuthorized(request,env))return respond({ok:false,error:"unauthorized"},401);
  if(!env?.TIER3_DB?.prepare)return respond({ok:false,error:"D1-required"},503);
  const url=new URL(request.url);
  const season=Number(url.searchParams.get("season")||2026);
  const week=Number(url.searchParams.get("week")||7);
  if(!Number.isInteger(season)||!Number.isInteger(week)||week<1||week>20)
    return respond({ok:false,error:"invalid-season-week"},400);
  try {
    const rows=await env.TIER3_DB.prepare(`SELECT snapshot_id,source_sha256,season,week,received_at,
     provider_published_at,row_count,feature_count,status,can_influence_projection,
     can_authorize_wager FROM cfb_tier3_training_snapshots
     WHERE season=? AND week=? ORDER BY received_at DESC LIMIT 10`)
     .bind(season,week).all();
    return respond({ok:true,source:"cfbd-tier3-weekly",networkCalls:0,
      snapshots:rows?.results||[],authority:"research_only"});
  } catch {return respond({ok:false,error:"tier3-index-unavailable"},503);}
}
