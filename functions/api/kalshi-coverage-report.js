import {kalshiCoverageReport} from "../lib/kalshiCoverageAudit.js";
const json=(body,status=200)=>Response.json(body,{status,
 headers:{"cache-control":status===200?"public, max-age=30":"no-store",
  "x-content-type-options":"nosniff","x-robots-tag":"noindex"},
});
/** R2 only. No Kalshi, ESPN, D1, or private account requests. */
export async function onRequestGet({request,env}){
 const sport=(new URL(request.url).searchParams.get("sport")||"").toLowerCase();
 if(sport&&!["nfl","cfb"].includes(sport))
  return json({ok:false,code:"KALSHI_COVERAGE_SPORT_NOT_ENABLED"},400);
 return json(await kalshiCoverageReport(env,{sport:sport||null}));
}
export async function onRequestPost(){
 return json({ok:false,code:"READ_ONLY"},405);
}
