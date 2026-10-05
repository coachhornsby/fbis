import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { buildTennisV2Validation } from "../lib/tennisV2Ledger.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}

export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const u=new URL(context.request.url);
  const limit=Math.max(100,Math.min(10000,Number(u.searchParams.get("limit"))||5000));
  try{
    const res=await context.env.DB.prepare(
      `SELECT id,canonical_event_id,tour,player1,player2,pure_p1,market_prior_p1,market_v2_p1,
              market_residual,model_edge,result_winner,closing_p1_no_vig,clv,profit_units,
              decision_timestamp,event_start_time,graded_at
       FROM tennis_v2_research_decisions
       ORDER BY decision_timestamp DESC LIMIT ?`
    ).bind(limit).all();
    const rows=res?.results||[];
    const report=buildTennisV2Validation(rows);
    return json({
      ok:true,report,
      interpretation:{
        primaryMetric:"prospective closing-line value",
        promotionRule:"Requires adequate prospective sample, >52% positive CLV, positive ROI, and manual review.",
        moneylineHistoricalStatus:"v1.1-DEEP failed 2018-2019 Pinnacle economic validation",
        wagerAuthorization:"OFF"
      }
    });
  }catch(err){return json({ok:false,error:String(err?.message||err)},500)}
}
