import { buildSportAccountabilityReport } from "../lib/sportAccountability.js";
import { SPORT_SIM_SPORTS } from "../lib/sportSimulationResearch.js";
import { querySnapshots } from "../lib/store.js";

const json=(payload,status=200)=>new Response(JSON.stringify(payload),{
  status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},
});
/** Fan out through the *current canonical* sport routing to avoid stale primary
 * NFL results when an independently qualified sport database is activated.
 * Errors remain visible; no sport silently claims a zero-result success. */
export async function readAccountabilitySnapshots(env,{sport,since,until},read=querySnapshots){
  const sports=sport==="all"?SPORT_SIM_SPORTS:[sport];
  const output=await Promise.all(sports.map(async name=>{
    try{
      const page=await read(env,{sport:name,since,until});
      return {sport:name,ok:page?.ok===true,rows:page?.ok===true?page.rows||[]:[],reason:page?.ok===true?null:"READ_FAILED"};
    }catch{return {sport:name,ok:false,rows:[],reason:"READ_FAILED"}}
  }));
  return {rows:output.flatMap(item=>item.rows),failedSports:output.filter(item=>!item.ok).map(item=>item.sport)};
}
/**
 * Read-only, aggregate-first operator research endpoint.
 * Uses the existing canonical primary snapshot ledger in shadow-migration mode.
 * Unlike player-prop research, it does not expose betting selections or secrets.
 */
export async function onRequestGet(context) {
  const url=new URL(context.request.url);
  const sport=String(url.searchParams.get("sport")||"all").toLowerCase();
  const days=Number(url.searchParams.get("days")||14);
  if(sport!=="all"&&!SPORT_SIM_SPORTS.includes(sport))return json({ok:false,error:"unsupported-sport"},400);
  if(!Number.isInteger(days)||days<1||days>30)return json({ok:false,error:"days-out-of-range"},400);
  if(!context.env?.DB?.prepare)return json({ok:false,error:"primary-snapshot-database-unavailable",degraded:true},503);
  try {
    const date=new Date();
    const end=date.toISOString().slice(0,10);
    const start=new Date(date.getTime()-(days+1)*86400000).toISOString().slice(0,10);
    // Existing prediction snapshot helper owns legacy schema mapping. Never write,
    // migrate or switch the underlying authoritative sport database here.
    const result=await readAccountabilitySnapshots(context.env,{sport,since:start,until:end});
    if(result.failedSports.length && sport!=="all")
      return json({ok:false,error:"snapshot-read-failed",degraded:true,failedSports:result.failedSports},503);
    // A bounded public response: no raw feature data or historical probabilities.
    // Large windows should be shortened rather than silently truncated.
    if(result.rows.length>12000)return json({ok:false,error:"snapshot-volume-limit",degraded:true,
      hint:"Reduce days or select a sport"},413);
    const report=buildSportAccountabilityReport(result.rows,{
      sport, windowDays:days, generatedAt:date.toISOString(),
    });
    for(const record of report.sports){if(result.failedSports.includes(record.sport))record.status="READ_DEGRADED";}
    return json({...report, queriedSnapshotRows:result.rows.length,range:{start,end},
      access:"aggregate-read-only",storageAuthority:"existing-sport-routing-unmodified",
      degraded:result.failedSports.length>0, failedSports:result.failedSports});
  }catch(err){
    return json({ok:false,error:"accountability-report-failed",degraded:true},503);
  }
}
