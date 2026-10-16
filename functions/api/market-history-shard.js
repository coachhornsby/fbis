/** Operator-only parity check; no public odds, raw provider data, or mutations. */
import {harvestSecret} from "../lib/auth.js";
import {verifyMarketHistoryShard} from "../lib/marketHistoryShard.js";
const headers={"content-type":"application/json; charset=utf-8","cache-control":"private, no-store","x-content-type-options":"nosniff"};
const json=(body,status)=>new Response(JSON.stringify(body),{status,headers});
export async function onRequestGet(context) {
  const expected=harvestSecret(context?.env);
  const supplied=context?.request?.headers?.get("x-harvest-secret");
  if(!expected || !supplied || supplied!==expected) return json({ok:false,error:"FORBIDDEN"},403);
  const url=new URL(context.request.url);
  const limitText=url.searchParams.get("limit") || "20";
  const source=url.searchParams.get("source");
  if(!/^([1-9]|[12]\d|30)$/.test(limitText))return json({ok:false,error:"INVALID_LIMIT"},400);
  if(source!==null && !["Polymarket US","Polymarket US WebSocket","PinnOdds"].includes(source))
    return json({ok:false,error:"SOURCE_OUT_OF_SCOPE"},400);
  try{
    const verify=context.verifyShard || verifyMarketHistoryShard;
    const result=await verify(context.env,{source,limit:Number(limitText)});
    return json({ok:true,...result},200);
  }catch{
    return json({ok:false,error:"SHARD_PARITY_UNVERIFIED",state:"FAIL_CLOSED",
      readOnly:true,canQualify:false,canAuthorizeWager:false},503);
  }
}
export async function onRequestPost(){return json({ok:false,error:"METHOD_NOT_ALLOWED"},405)}
