import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { buildWnbaWagerValidation } from "../lib/wnbaWagerValidation.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0"}});
}

export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  try{
    const res=await context.env.DB.prepare(
      `SELECT d.*,r.result,r.win,r.push,r.close_line,r.close_price,r.clv_line,r.clv_price,r.settled_at
         FROM wnba_wager_decisions d
         JOIN wnba_wager_results r ON r.decision_id=d.id
        ORDER BY COALESCE(r.settled_at,d.captured_at),d.id`
    ).all();
    const report=buildWnbaWagerValidation(res?.results||[]);
    return json({ok:true,report});
  }catch(err){
    return json({ok:false,error:String(err?.message||err)},500);
  }
}
