import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { pitchApiModelHistorySelect } from "../lib/soccerPitchApiStore.js";
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(),401);
  const u=new URL(context.request.url),league=String(u.searchParams.get("league")||""),
    before=String(u.searchParams.get("before")||"9999-12-31"),
    start=String(u.searchParams.get("start")||"2021-01-01"),
    mode=String(u.searchParams.get("mode")||"raw");
  if(!["raw","model"].includes(mode))return json({ok:false,error:"unsupported-export-mode"},400);
  if(!league||!context.env?.DB?.prepare)return json({ok:false,error:!league?"league-required":"d1-unbound"},400);
  const requested=Number(u.searchParams.get("limit")||250),requestedOffset=Number(u.searchParams.get("offset")||0);
  if(!Number.isSafeInteger(requested)||requested<1||!Number.isSafeInteger(requestedOffset)||requestedOffset<0||requestedOffset>100000)
    return json({ok:false,error:"invalid-export-pagination"},400);
  // Raw source responses can be tens of KB per match. Enforce a much tighter
  // budget than the model-only scalar projection used by walk-forward.
  const limit=Math.min(requested,mode==="model"?250:40),offset=requestedOffset;
  const cols=mode==="model"?pitchApiModelHistorySelect():"*";
  const r=await context.env.DB.prepare(`SELECT ${cols} FROM soccer_pitchapi_match_features
    WHERE league_key=? AND match_date>=? AND match_date<? AND status='finished'
    ORDER BY match_date,pitch_match_id LIMIT ? OFFSET ?`).bind(league,start,before,limit,offset).all();
  const rows=r?.results||[];
  return json({ok:true,league,start,before,mode,offset,limit,count:rows.length,
    nextOffset:rows.length===limit?offset+rows.length:null,rows,source:"PitchAPI",
    marketUsed:false,researchOnly:true,canQualify:false,canAuthorize:false});
}
