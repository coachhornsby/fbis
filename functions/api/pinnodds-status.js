import { pinnOddsBudgetStatus } from "../lib/pinnOddsRest.js";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
/** Read-only aggregate. No credential, exact prices, provider raw data, or execution controls. */
export async function onRequestGet({env}){
 if(!env?.DB?.prepare)return json({ok:false,reason:"D1_UNAVAILABLE"},503);
 try{
  const [budget,states,counts]=await Promise.all([
   pinnOddsBudgetStatus(env.DB),
   env.DB.prepare("SELECT sport_id,last_full_at,last_success_at,last_data_status,last_data_age_ms,last_event_count,last_offer_count,last_failure FROM pinnodds_feed_state ORDER BY sport_id").all(),
   env.DB.prepare("SELECT sport,COUNT(*) observations,COUNT(DISTINCT canonical_event_id) matched_events,MAX(collected_at) last_capture FROM normalized_market_observations WHERE source='PinnOdds' AND collected_at >= datetime('now','-24 hours') GROUP BY sport").all()
  ]);
  return json({...budget,source:"PinnOdds",sourceKind:"Pinnacle-sourced reference only",transport:"REST_ONLY",streaming:false,freeTier:true,canQualify:false,canAuthorizeWager:false,independentModelsPreserved:true,fullCoverageVerified:false,providerObservedAtVerified:false,feedStates:states.results||[],sportCoverage:counts.results||[]});
 }catch{return json({ok:false,reason:"STATUS_READ_UNAVAILABLE"},503)}
}
export async function onRequestPost(){return json({ok:false,reason:"METHOD_NOT_ALLOWED"},405)}
