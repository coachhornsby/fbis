import { buildSportAccountabilityReport } from "../lib/sportAccountability.js";
import { SPORT_SIM_SPORTS } from "../lib/sportSimulationResearch.js";
import { querySnapshots } from "../lib/store.js";

const json=(payload,status=200)=>new Response(JSON.stringify(payload),{
  status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},
});
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
    const result=await querySnapshots({...context.env, DB:context.env.DB},{
      sport, since:start, until:end,
    });
    if(!result.ok)return json({ok:false,error:"snapshot-read-failed",degraded:true},503);
    // A bounded public response: no raw feature data or historical probabilities.
    // Large windows should be shortened rather than silently truncated.
    if(result.rows.length>12000)return json({ok:false,error:"snapshot-volume-limit",degraded:true,
      hint:"Reduce days or select a sport"},413);
    const report=buildSportAccountabilityReport(result.rows,{
      sport, windowDays:days, generatedAt:date.toISOString(),
    });
    return json({...report, queriedSnapshotRows:result.rows.length,range:{start,end},
      access:"aggregate-read-only",storageAuthority:"legacy-primary-unmodified"});
  }catch(err){
    return json({ok:false,error:"accountability-report-failed",degraded:true},503);
  }
}
