import { archiveUnderdogSnapshot, fetchUnderdogLines, filterUnderdogLines } from "../../lib/underdogClient.js";

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*"}});

export async function onRequestGet(context){
  const u=new URL(context.request.url);
  const result=await fetchUnderdogLines();
  const filtered=filterUnderdogLines(result,{
    sport:u.searchParams.get("sport"),league:u.searchParams.get("league"),statFamily:u.searchParams.get("statFamily")||u.searchParams.get("stat"),
    player:u.searchParams.get("player"),event:u.searchParams.get("event"),date:u.searchParams.get("date"),
  });
  const debug=u.searchParams.get("debug")==="1";
  const archive=u.searchParams.get("archive")==="1";
  let snapshot=null;
  if(archive&&filtered.ok)snapshot=await archiveUnderdogSnapshot(context.env,filtered,{sport:u.searchParams.get("sport")||"all"}).catch(e=>({archived:false,reason:String(e?.message||e)}));
  const rows=filtered.lines.map(r=>debug?r:({...r,raw:undefined}));
  return json({
    ok:filtered.ok,fetchedAt:filtered.fetchedAt,source:filtered.source,rawCount:filtered.rawCount,normalizedCount:rows.length,
    warnings:filtered.warnings||[],schema:debug?filtered.schema:undefined,cache:filtered.cache,lines:rows,snapshot,
    governance:{marketDataOnly:true,decisionEligible:false,canQualify:false,canAuthorizeWager:false},
  },filtered.ok?200:503);
}
