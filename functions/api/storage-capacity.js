import {harvestSecret} from "../lib/auth.js";

/** Accurate D1 storage telemetry from the binding query metadata.
 * SQLite dbstat/page_count is not authorized on production D1.
 * Workers Paid account-wide billing is usage-based, NOT capped at 5 GB.
 */
export const D1_DATABASE_MAX_BYTES = 10_000_000_000;
const response = (value,status=200)=>new Response(JSON.stringify(value),{status,headers:{
  "content-type":"application/json; charset=utf-8","cache-control":"private, no-store",
  "x-content-type-options":"nosniff",
}});
export function summarizeD1Storage(primaryBytes,shardBytes){
  const safe=n=>Number.isSafeInteger(n)&&n>0;
  if(!safe(primaryBytes)||!safe(shardBytes))throw Error("STORAGE_SIZE_UNAVAILABLE");
  const info=(bytes)=>{
    const ratio=bytes/D1_DATABASE_MAX_BYTES;
    return {usedBytes:bytes,hardLimitBytes:D1_DATABASE_MAX_BYTES,
      remainingBytes:Math.max(0,D1_DATABASE_MAX_BYTES-bytes),
      percentUsed:Number((ratio*100).toFixed(3)),
      state:ratio>=1?"OVER_LIMIT":ratio>=0.99?"EMERGENCY":ratio>=0.95?"CRITICAL":ratio>=0.85?"HIGH":"OK"};
  };
  return {state:primaryBytes>=D1_DATABASE_MAX_BYTES?"PRIMARY_OVER_LIMIT":
    primaryBytes>=D1_DATABASE_MAX_BYTES*0.95?"PRIMARY_CRITICAL":"PRIMARY_WITH_HEADROOM",
    primary:info(primaryBytes),historyShard:info(shardBytes),
    knownBoundD1Bytes:primaryBytes+shardBytes,
    accountWideUsageMeasured:false,
    r2BillableBytesMeasured:false,
    invoiceEstimated:false,
    historicRowsDeletedByProbe:0,
    sourceOfTruth:"PRIMARY_D1"};
}
export async function onRequestGet({env,request}={}){
  const secret=harvestSecret(env),provided=request?.headers?.get("x-harvest-secret");
  if(!secret||!provided||provided!==secret)return response({ok:false,error:"FORBIDDEN"},403);
  if(!env?.DB?.prepare||!env?.MARKET_HISTORY_DB?.prepare)
    return response({ok:false,error:"STORAGE_BINDING_UNAVAILABLE"},503);
  try{
    const [p,s]=await Promise.all([
      env.DB.prepare("SELECT 1 AS healthy").all(),
      env.MARKET_HISTORY_DB.prepare("SELECT 1 AS healthy").all(),
    ]);
    const result=summarizeD1Storage(Number(p?.meta?.size_after),Number(s?.meta?.size_after));
    return response({ok:true,...result});
  }catch{
    return response({ok:false,error:"STORAGE_METADATA_UNAVAILABLE"},503);
  }
}
export async function onRequestPost(){return response({ok:false,error:"METHOD_NOT_ALLOWED"},405)}
